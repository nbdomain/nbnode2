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
  key: "", //unique node key. use 'node key -c bitcoin' to generate
  "node_info": { //public info of the node
    nbdomain: "", //nbdomain of the node
    payment: { bsv: "1Bti24c8ZQLYMTaifVkiRwJ1cwT4K6ucJu", ar: "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ" }, //address to receive payment
    contact: "", //contact email of the owner,required for ssl certificate
  },
  chainid: 'main',
  adminKey: null, //enable remote admin features, check /api/admin endpoint
  server: {
    publicUrl: "", //public domain name or IP of the node, must set for public node and not set for private node
    autoSSL: false, //for auto generated SSL certificate, require publicUrl to be set
    port: 9000,  //local port for http service, https will use 443 and ignore this setting
    hideFromList: false //(optional) if add this node to /api/nodes endpoint
  },
  allowIPs: [],
  apiKeys: [],
  dataPath: "", //Existing Disk Path for big data, default is core/db/data
  pnodes: ["https://api.nbdomain.com"],//other(than public) nbnode peers and will not share with other nodes
  "exit_count": 0, //exit the process each x minutes. Used with PM2 to restart process every x minutes. 0 for no exit
}
// ------------------------------------------------------------------------------------------------

module.exports = {
  CONFIG
}
