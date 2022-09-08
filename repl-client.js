#! /usr/bin/env node

const WS = require("ws");
const URL =  require("node:url").URL;
const Path = require("path");
const WebSocket = WS.WebSocket;
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

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


//create a repl enviroment
const ws = new WebSocket(url.origin+url.pathname);

let id = url.searchParams.id;
let connected = false;

ws.addEventListener('open', (e) => {
    ws.send(`.select_client ${id}`);
    connected = true;
});

ws.addEventListener('message', (e) => {
    process.stdout.write(e.data);
});

ws.addEventListener('close', (e) => {
    console.log("disconnected");
    process.exit(1);
});

ws.addEventListener("error",(e)=>{
    if(!connected){
        console.log("connection refused or parent process not running");
    }else{
        console.log("connection error");
    }
    process.exit(1);
});

//readline loop
readline.on('line', function(line){
    ws.send(line);
})

