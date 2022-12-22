/**
 * config.js
 *
 * Configuration from environment variables
 */
const Path = require('path')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const CONFIG = {
  debug: true,
  key: "KyQYxHjX7ZHhNVamhuNs9JgvR7SM5FuMnbverckPLKi2ZG31zy5R",
  "node_info": { //public info of the node
    nbdomain: "107196.b", //nbdomain of the owner.
    payment: { bsv: "1Bti24c8ZQLYMTaifVkiRwJ1cwT4K6ucJu", ar: "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ" }, // Payment (if any) will goto this address.
    contact: "bloodchen@gmail.com", //contact email of the owner
  },
  adminKey: "123456",
  server: {
    publicUrl: "http://d.bitelf.net:9001",
    autoSSL: false,
    port: 9001,
    socketServer: "",
    socketPort: 31416,
    hideFromList: false,
  },
  dataPath: "", //Existing Disk Path for big data, default is core/db/data
  pnodes: ["https://tnode.nbdomain.com", "https://api.nbdomain.com"],
  "exit_count": 0, //exit the process each x minutes. Used with PM2 to restart process every x minutes. 0 for no exit
  getPath(name){
    if(this.path) return this.path[name]
    return Path.join(__dirname,name)
  }
}
// ------------------------------------------------------------------------------------------------

module.exports = {
  CONFIG
}
