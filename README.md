# Node-Client-Inspector
Express addon that brings up interactive repl for each connected clients
## Example
```js
const express = require("express");
const app = express();

const debug = require("./debugger.js");

//same as express-static, but modifies html files and insert debug client scripts
app.use(debug.static("frontend"));


const server = app.listen(4001,()=>{
    console.log("listening to 4001");
});

//creates a ws server that receives commands from the server, and executes,
//and return the result back to the server to be displayed
debug.createWSS(server);
```