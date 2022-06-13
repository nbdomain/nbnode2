/**
 * config.js
 *
 * Configuration from environment variables
 */


// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------
const CONFIG = {
  debug: true,
  "node_info": { //public info of the node
    nbdomain: "", //nbdomain of the node
    payment: { bsv: "1Bti24c8ZQLYMTaifVkiRwJ1cwT4K6ucJu", ar: "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ" }, //address to receive payment
    contact: "", //contact email of the owner,required for ssl certificate
  },
  server: {
    domain: "", //public domain name or IP of the node, must set for public node and not set for private node
    https: false, //for auto generated SSL certificate, require domain name to be set
    port: 9000,  //port for http service, https will use 443 and ignore this setting
    socketServer: "", //(optional)server domain/IP for socket RPC. Useful when domain is a proxy(not real) address. domain will be used if omitted
    socketPort: 31415, //(optional)port for socket RPC. default: 31415 . Plz make sure it's reachable from outside
    public: false, //(optional) Does this server provide public server? default:false
  },
  dataPath: "", //Existing Disk Path for big data, default is core/db/data
  peers: ["https://tnode.nbdomain.com"],//other(than public) nbnode peers and will not share with other nodes
  "exit_count": 0, //exit the process each x minutes. Used with PM2 to restart process every x minutes. 0 for no exit
}
// ------------------------------------------------------------------------------------------------

module.exports = {
  CONFIG
}
