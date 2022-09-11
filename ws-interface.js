const EventEmitter = require("events");


class WsInterface extends EventEmitter{
    static CloseError = class extends Error{};
    closed = false;
    constructor(ws){
        super();
        let that = this;
        this.ws = ws;
        ws.on("message",(data)=>{
            let type,payload;
            try{
                [type,payload] = JSON.parse(data);
            }catch(err){
                console.log(`wrong message format:\n`+
                    ` ${data.length > 200?data.slice(0,200)+"...":data}`);
                return;
            }
            that.emit(type,payload);
        });
        
        let connected = false;
        ws.on("close", (e) => {
            that.closed = true;
            that.emit("close",e);
        });

        ws.on("error",(e)=>{
            if(!connected){
                that.emit("initerror",e);
            }else{
                that.emit("error",e);
            }
            process.exit(1);
        });
        ws.on("open",(e)=>{
            that.emit("open",e);
        });
    }
    send(type,val){
        this.ws.send(JSON.stringify([type,val]));
    }
    awaitOnce(evt){
        let that = this;
        return new Promise(res=>{
            that.once(evt,res);
        });
    }
    select(obj){//just like select from golang
        //listen to these events once, and cancel after one fires
        //obj === {type:listener} pair
        let that = this;
        let wrappers = [];
        for(let type in obj){
            let listener = obj[type];
            let wrapper = function(){
                listener(...arguments);
                //cancel all
                for(let w of wrappers){
                    that.off(type,w);
                }
            }
            wrappers.push(wrapper);
            this.on(type,wrapper);
        }
    }
};

module.exports = WsInterface;









