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
const clients = [];
const displayClients = function(){
    console.log(clients.map(c=>c.uagent));
};


//keeps trak of user ws sessions
class Client{
    constructor(ws,uagent){
        this.ws = ws;
        this.uagent = uagent;
    }
    exec(str){
        return new Promise(res=>{
            this.ws.send(str);
            this.ws.once("message",(data)=>{
                console.log(...JSON.parse(data));
                res();
            });
        });
    }
};

let createWSS = function(server){
    //listen to websocket

    const wss = new ws.Server({server, path: '/debug/console'});

    wss.on('connection', async function connection(ws) {
        ws.send("window.navigator.userAgent");
        let uagent = JSON.parse(await new Promise(res=>{
            ws.once("message",res)[0];
        }));
        console.log(`new client connected ${uagent}`);
        clients.push(new Client(ws,uagent));
    });
}




module.exports = {
    static,createWSS,clients,displayClients
};




