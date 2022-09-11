#! /usr/bin/env node

const WS = require("ws");
const WebSocket = WS.WebSocket;
const WsInterface = require("./ws-interface.js");
const URL =  require("node:url").URL;
const repl = require("node:repl");



//server singleton
//mirrors the design of Client class in index.js
class Server extends WsInterface{
    constructor(url){
        super(new WebSocket(url));
    }
    executing = false;
    async cmd(name,args){//send and execute commands
        if(this.executing){
            console.log("Another command is under execution");
            return;
        }
        this.send(name,args);
        this.executing = true;
        let result = await this.awaitOnce("cmdreturn");
        this.executing = false;
        return result;
    }
};



let main = async function(){
    let url = process.argv[2];
    if(!url){
        console.log("please provide an endpoint url");
        process.exit(1);
    }
    try{
        url = new URL(url);
    }catch(err){
        console.log("invalid URL");
        //console.log(err);
        process.exit(1);
    }
    
    let server = new Server(url.origin+url.pathname);
    server.on("initerror",(err)=>{
        console.log(err);
        console.log("Please make sure that the parent server is running");
    });
    server.on("close",()=>{
        console.log("disconnected");
        process.exit(1);
    });
    await server.awaitOnce("open");
    
    if(url.searchParams.get("id") !== null)
        console.log(await server.cmd("select_client",url.searchParams.get("id")));
    
    //repl
    const replServer = repl.start({
        prompt: '> ',
        eval: async (cmd, context, filename, callback)=>{
            if(cmd.trim() === ""){
                callback(null,"\u001bM");
            }else{
                callback(null,await server.cmd("exec",cmd));
            }
        },
        writer: (output)=>{
            return output;//return as it is
        }
    });
    
    server.on("log",(val)=>{
        console.log(val);
    });

    //register commands
    let commands = {
        ls:"list available clients with their ids",
        select_client:"select client with given id",
        client_info:"displays information about the selected client"
    }
    
    for(let cmd in commands){
        let help = commands[cmd];
        replServer.defineCommand(cmd,{
            help,
            async action(args) {
                console.log(await server.cmd(cmd,args));
                this.displayPrompt();
            }
        });
    }
}


main();





