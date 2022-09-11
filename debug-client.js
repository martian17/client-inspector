//util functions
function isIterable(obj) {
    // checks for null and undefined
    if (obj == null) {
        return false;
    }
    return typeof obj[Symbol.iterator] === 'function';
};

//duplicate safe json
let safeStringify = function(obj0) {
    let dupList = new Map();
    let dmax = 0;
    let dlimit = 4;
    let traverse = function(o,d) {
        if(d > dmax)dmax = d;
        if(typeof o === "function"){
            return "f()"
        }else if(typeof o !== "object" || o === null){
            return o;
        }else if(o instanceof Node){
            return `HTML ${o.nodeName}`
        }else{//object
            if(dupList.has(o))return "[[*dup]]";
            dupList.set(o,true);
            if(isIterable(o)){
                if(d >= dlimit)return "[too deep]";
                let arr = [];
                for(let v of o){
                    arr.push(traverse(v,d+1));
                }
                return arr;
            }else{
                if(d >= dlimit)return "{too deep}";
                //normal key value pair
                let obj = {};
                for(let v in o){
                    obj[v] = traverse(o[v],d+1);
                }
                return obj;
            }
        }
    }
    let cleaned = traverse(obj0,1);
    console.log(`depth: ${dmax}`);
    let ret = JSON.stringify(cleaned);
    console.log(ret);
    return ret;
};



(async () => {
    const ws = new WebSocket("ws://" + location.host + "/debug/console");
    ws.awaitOnce = function(type){
        return new Promise(res=>{
            let listener = (e)=>{
                let data = e.data;
                ws.removeEventListener(type,listener);
                res(data);
            };
            ws.addEventListener(type,listener);
        });
    };
    
    let log;

    // Connection opened
    ws.addEventListener('open', (e) => {
        log = function() {
            let msg = [...arguments];
            console.log(msg, safeStringify(msg));
            ws.send(JSON.stringify(["log",safeStringify(msg)]));
        }
        //log("hello from client");
    });

    //eval scope
    while (true) {
        let code = (await ws.awaitOnce("message")+"").trim();
        
        try{
            let result = await eval(`(async ()=>{return ${code}})()`);
            console.log(code,result);
            ws.send(JSON.stringify(["return",safeStringify(result)]));
        }catch(err){
            ws.send(JSON.stringify(["return",err.toString()]));
        }
    }
})();