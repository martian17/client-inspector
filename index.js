//const send = require("send");
const parseUrl = require("parseurl");
const path = require("path");
const fsp = require("fs").promises;
const ws = require("ws");

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
    str += `active clients at ${Date()}:`;
    for(let key in clients){
        str += ` ${key}: ${clients[key].uagent}`;
    }
    return str;
};


//Client class: keeps trak of user ws sessions
let CID = 0;
class Client{
    executing = false;
    constructor(ws,uagent){
        this.ws = ws;
        this.uagent = uagent;
        this.id = ++CID;
        clients[this.id] = this;
    }
    exec(str){
        let that = this;
        this.executing = true;
        return new Promise(res=>{
            this.ws.send(str);
            this.ws.once("message",(data)=>{
                //console.log(...JSON.parse(data));
                that.executing = false;
                res(data+"");
            });
        });
    }
    destroyHooks = new Map();
    addDestroyHook(hook){
        this.destroyHooks.set(hook,true);
        return{
            remove:()=>{
                this.destroyHooks.delete(hook);
            }
        }
    }
    destroy(){
        delete clients[this.id];
        for(let [hook,_] of this.destroyHooks){
            hook();
        }
    }
};


let createWSS = function(server){
    //client facing wss
    const wss = new ws.Server({server, path: '/debug/console'});

    wss.on('connection', async function connection(ws) {
        ws.send("window.navigator.userAgent");
        let uagent = JSON.parse(await new Promise(res=>{
            ws.once("message",res)[0];
        }));
        console.log(`new client connected ${uagent}`);
        let client = new Client(ws,uagent);
        
        ws.once("close",()=>{
            client.destroy();
        });
    });
    
}

//initialize repl facing wss


//ws module modification
//bad bad bad
/*
{
    const oldon = ws.WebSocket.prototype.on.bind(ws.WebSocket.prototype);
    ws.WebSocket.prototype.on = function addListener(type, listener){
        const target = oldon(type,listener);
        return {
            remove:()=>{
                target.removeListener(type,listener);
            }
        }
    };
}
*/

class EventTracker{
    events = [];
    on(target,type,listener){
        events.push(target,type,listener);
        target.on(type,listener);
        return target;
    }
    once(target,type,listener){
        events.push(target,type,listener);
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





{
    let extractCommand = function(data){
        let arr = data.split(" ");
        let args = arr.slice(1).join(" ");
        let cmdname = arr[0];
        return [cmdname,args];
    };
    
    
    const wssrepl = new ws.WebSocketServer({port:4002});
    wssrepl.on("connection",async(ws)=>{
        
        //let sendLine = function(ln){
        //}
        
        let client = null;
        let events = new EventTracker;
        const dotcmds = {
            ".ls":()=>{
                ws.send(createClientList()+"\n");
            },
            ".help":()=>{
                ws.send(`list of available commands: ${Object.keys(dotcmds).join(" ")}\n`);
            },
            ".select_client":(args)=>{
                let cid = args.trim();
                if(cid === ""){
                    ws.send(`Please provide the client id\n`);
                }else if(!(cid in clients)){
                    ws.send(`client id ${cid} not found\n`);
                }else{
                    setClient(clients[cid]);
                    ws.send(`client ${cid} selected\n`);
                }
            },
            ".client_info":()=>{
                if(client !== null){
                    ws.send(client.uagent+"\n");
                }else{
                    ws.send(`no client selected\n`);
                }
            }
        };
        
        
        
        const setClient = function(c){
            if(client !== null){
                events.removeAll();
            }
            client = c;
            
            events.once(client,"disconnect",()=>{
                ws.send(`disconnected from client ${client.uagent}\n`);
                events.removeAll();
                client = null;
            });
            events.on(client,"log",(data)=>{
                ws.send(data+"\n");
            });
            events.once(ws,"close",()=>{
                console.log("repl client disconnected\n");
                events.removeAll();
            });
        }
        
        
        ws.on("message",async (data)=>{
            data = (data+"").trim();//to string
            if(data.length === 0){
                ws.send("> ");
                return;
            }
            if(data[0] === "."){//dot command
                const [cmdname,args] = extractCommand(data);
                if(!(cmdname in dotcmds)){
                    ws.send(`REPL error: unknown command ${data}\n`);
                }else{
                    dotcmds[cmdname](args);
                }
                if(client === null || client.executing === false){
                    ws.send("> ");
                }
            }else if(client !== null){
                //normal command
                ws.send(await client.exec(data)+"\n> ");
            }else{
                ws.send("> ");
            }
        });
    });
}


module.exports = {
    static,createWSS,clients,createClientList
};




