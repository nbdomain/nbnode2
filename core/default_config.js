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
    domain: "", //public domain name or IP of the node
    https: false, //for auto generated SSL certificate, require domain name be set
    port: 9000,  //port for http service
  },
  dataPath: "", //Existing Disk Path for big data, default is core/db/data
  peers: ["https://tnode.nbdomain.com"],//other(than public) nbnode peers (optional)
  "exit_count": 0, //exit the process each x minutes. Used with PM2 to restart process every x minutes. 0 for no exit
}
// ------------------------------------------------------------------------------------------------

module.exports = {
  CONFIG
}
