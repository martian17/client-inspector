//const send = require("send");
const parseUrl = require("parseurl");
const path = require("path");
const fsp = require("fs").promises;
const ws = require("ws");
const EventEmitter = require('events');
const WsInterface = require("./ws-interface.js");

class EventTracker{
    events = [];
    on(target,type,listener){
        this.events.push([target,type,listener]);
        target.on(type,listener);
        return target;
    }
    once(target,type,listener){
        this.events.push([target,type,listener]);
        target.once(type,listener);
        return target;
    }
    removeAll(){
        for(let [target,type,listener] of this.events){
            target.removeListener(type,listener);
        }
        this.events = [];
    }
};


let skipHTMLComments = function(str,i){
    let c = str[i];
    if(c === "<" && str.slice(i,i+4) === "<!--"){
        //comment
        //<!---->
        i += 6;
        while(true){
            //skip non relevant
            while(str[i] !== ">"){
                i++;
            }
            if(str.slice(i-2,i+1) === "-->"){
                i++;
                break;
            }
        }
    }
    return i;
};

let insertDebugScript = function(str){
    
    for(let i = 0; i < str.length; i++){
        i = skipHTMLComments(str,i);
        if(i >= str.length)break;
        let c = str[i];
        if(c === "<"){
            if(str.slice(i,i+6) === "<head>"){
                let head = str.slice(0,i+6);
                let tail = str.slice(i+6);
                str = head+"\n<script src=\"/debug/debug-client.js\"></script>\n"+tail;
                break;
            }
        }
    }
    return str;
};



let static = function(static_path0){
    const static_root = path.resolve(static_path0);
    console.log(static_root);
    return async (req,res,next)=>{
        let pathname = parseUrl(req).pathname;
        
        //special case, debug script
        if(pathname === "/debug/debug-client.js"){
            res.sendFile(path.join(__dirname,"debug-client.js"));
            return;
        }
        
        let p = path.join(static_root,pathname);
        if(p.indexOf(static_root) !== 0){
            res.status(403).send("403 forbidden");
            return;
        }
        //check if the path points to a directory
        let stat;
        try{
            stat = await fsp.stat(p);
            if(stat.isDirectory()){
                p = path.join(p,"index.html");
                stat = await fsp.stat(p);
            }
        }catch(err){
            if(err.code === 'ENOENT'){
                //file DNE
                next();
                return;
            }else{
                console.log("unexpected error: ",err);
                console.log("path: ",req.url);
                res.status(403).send("403 forbidden");
                return;
            }
        }
        if(!stat.isFile()){
            //expected file, but got non-file
            //pretend nothing was found
            next();
            return;
        }
        //now path is a file that belong to static_root
        if(path.extname(p) === ".html"){
            console.log(`html requested: ${p}. inserting debug script`);
            //modify for debug
            let str = await fsp.readFile(p)+"";
            res.status(200).send(insertDebugScript(str));
        }else{
            res.status(200).sendFile(p);
        }
    };
};



//wss stuff
const isObjectEmpty = function(obj){
    for(let key in obj){
        return false;
    }
    return true;
};


const clients = Object.create(null);
const createClientList = function(){
    if(isObjectEmpty(clients)){
        return "No clients are connected at the moment";
    }
    let str = "";
    str += `active clients at ${Date()}:\n`;
    for(let key in clients){
        str += ` ${key}: ${clients[key].uagent}`;
    }
    return str;
};


//Client class: keeps trak of user ws sessions
let CID = 0;
class Client extends WsInterface{
    executing = false;
    constructor(ws){
        super(ws);
        this.handshake();
    }
    async handshake(){
        try{
            let uagent = await this.exec("window.navigator.userAgent");
            this.uagent = uagent;
            this.id = ++CID;
            clients[this.id] = this;
            console.log(`New client connected: ${uagent}`);
            console.log(`Connect to this client by opening another terminal, navigate to this directory,`+
            ` and type "npm exec inspect-client ws://localhost:4002/debug/repl?id=${this.id}"`);
        }catch(err){
            console.log("client connected but handshake failed. Please refresh the client.");
        }
    }
    exec(str){
        let that = this;
        this.executing = true;
        this.ws.send(str);
        return this.awaitOnce("return");
        return new Promise((res,rej)=>{
            that.select({
                "error":(e)=>{
                    rej(e);
                },
                "close":()=>{
                    rej(new WsInterface.CloseError(
                        "Connection closed by client mid execution"
                    ));
                },
                "return":(data)=>{
                    res(data);
                }
            });
        });
        return new Promise((res,rej)=>{
            that.once("return",(payload)=>{
                that.executing = false;
                res(payload);
            });
        });
    }
    destroy(){
        this.emit("close");
        delete clients[this.id];
    }
};


let createWSS = function(server){
    //client facing wss
    const wss = new ws.Server({server, path: '/debug/console'});

    wss.on('connection', async function connection(ws) {
        let client = new Client(ws);
        ws.once("close",()=>{
            client.destroy();
        });
    });
}

//initialize repl facing wss
class ReplClient extends WsInterface{
    constructor(ws){
        super(ws);
        let that = this;
        let client = null;
        
        this.on("ls",()=>{
            that.cmdreturn(createClientList());
        });
        this.on("select_client",(arg)=>{
            let cid = arg.trim();
            if(cid === ""){
                that.cmdreturn(`Please provide the client id`);
            }else if(!(cid in clients)){
                that.cmdreturn(`client id ${cid} not found`);
            }else{
                setClient(clients[cid]);
                that.cmdreturn(`client ${cid} selected`);
            }
        });
        this.on("client_info",()=>{
            if(client !== null){
                that.cmdreturn(client.uagent);
            }else{
                that.cmdreturn(`no client selected`);
            }
        });
        this.on("exec",async (code)=>{
            if(client === null){
                that.cmdreturn("Client not selected. To select a client, "+
                "first type .ls to get the list of clients, "+
                "and type .select_client {{id}} to select a client. "+
                "For more info. Please type .help");
            }else{
                that.cmdreturn(
                    await client.exec(code)
                    .catch((err)=>{
                        if(err instanceof WsInterface.CloseError){
                            return undefined;
                        }else{
                            //unknown error
                            throw err;
                            process.exit(1);
                        }
                    })
                );
                
            }
        });
        
        const events = new EventTracker();
        let setClient = function(cli){
            if(client !== null){
                //cancel the previous log events
                events.removeAll();
            }
            client = cli;
            events.once(client,"close",()=>{
                that.log("client disconnected");
                events.removeAll();
                client = null;
            });
            events.once(client,"log",function(){
                that.log(...arguments);
            });
        }
        
        
        this.on("close",()=>{
            events.removeAll();
            console.log("repl client disconnected");
        });
    }
    cmdreturn(val){
        if(!this.closed)this.send("cmdreturn",val);
    }
    log(val){
        if(!this.closed)this.send("log",val);
    }
};


const wssrepl = new ws.WebSocketServer({port:4002});
wssrepl.on("connection",async(ws)=>{
    const repl = new ReplClient(ws);
});


module.exports = {
    static,createWSS,clients,createClientList
};




