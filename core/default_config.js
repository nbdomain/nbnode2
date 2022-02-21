/**
 * config.js
 *
 * Configuration from environment variables
 */


// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const API = {
  bsv:"planaria",ar:'arnode'
  }  // 'planaria','mattercloud','urchain','nbnode'
const PLANARIA_TOKEN = ""
const NODEKEY = "" //base64ed private key of the nbdomain in node_info. Used to verify the node
const NETWORK = 'main'
const TXDB = 'txs.db'
const DMDB = 'domains.db'
const FETCH_LIMIT =  20
const START_HEIGHT = 613645
const TIMEOUT = 10000
const MEMPOOL_EXPIRATION =  60 * 60 * 24

require('axios').default.defaults.timeout = TIMEOUT

const CONFIG = {
  debug: true,
  "node_info": {
    nbdomain: "", //nbdomain of the node
    payment:{bsv:"1Bti24c8ZQLYMTaifVkiRwJ1cwT4K6ucJu",ar:""}, //address to receive payment
    domain: "", //domain name or IP of the node
    contact: "", //contact email of the owner,required for ssl certificate
    https:false, //for auto generated SSL certificate
    port:9000,  //port for http service
    prices: {
      domainHost:  {bsv:1000,ar:1000}, //host user's triditional domain and link to a nbdomain
      keyUpdate: {bsv:1000,ar:1000}
    }
  },
  peers:[],//other(than public) nbnode peers (optional)
  "exit_count": 0, //exit the process each x minutes. Used with PM2 to restart process every x minutes. 0 for no exit
  "proxy_map": {
    "/api/": "api",
    "/web/": "web"
  },
  "nidcheck_endpoint": "https://util.nbsite.link/namecheck/v1/check/",
  "admin": {
    "transfer_fee": 1000,
    "transfer_fee_rate": 0.1
  },
  "tld_config": {
    "test": {
      "testing": true,
      "blockchain":"bsv",
      "address": {
        "payment": "19fLpT5LpaMGKuLfUVqmNdXkVceq2rbjyn",
        "protocol": "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5",
        "admin": "1KEjuiwj5LrUPCswJZDxfkZC8iKF4tLf9H",
        "other_admins": [
          {
            "address": "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5",
            "start_block": 0,
            "end_block": 658652
          },
        ]
      },
    },
    "b": {
      "testing": false,
      "blockchain":"bsv",
      "address": {
        "payment": "15Cww7izEdyr8QskJmqwC5ETqWREZCjwz4",
        "protocol": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
        "admin": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
        "other_admins": []
      },
    },
    "a": {
      "blockchain":"ar",
      "address": {
        "payment": "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ",
        "protocol": "ardomaina",
        "admin": "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ",
        "other_admins": []
      },
    }
  }
}
// ------------------------------------------------------------------------------------------------

module.exports = {
  API,
  PLANARIA_TOKEN,
  NETWORK,
  NODEKEY,
  TXDB,
  DMDB,
  FETCH_LIMIT,
  START_HEIGHT,
  MEMPOOL_EXPIRATION,
  CONFIG
}
