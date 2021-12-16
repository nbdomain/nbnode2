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
const NETWORK = 'main'
const TXDB = 'txs.db'
const DMDB = 'domains.db'
const FETCH_LIMIT =  20
const START_HEIGHT = 613645
const TIMEOUT = 10000
const MEMPOOL_EXPIRATION =  60 * 60 * 24
const ZMQ_URL = null
const RPC_URL = null

require('axios').default.defaults.timeout = TIMEOUT

const CONFIG = {
  debug: true,
  "node_info": {
    payment: "1LQ2tBsvBvaUsxrg14TeRoiLjWoaAwsTLH", //address of the owner. Payment (if any) will goto this address.
    domain: "", //domain name of the node, for SSL certificate. Replace with real domain
    contact: "", //contact email of the owner
    prices: {
      domainHost:  {bsv:1000,ar:1000}, //host user's triditional domain and link to a nbdomain
      keyUpdate: {bsv:1000,ar:1000}
    }
  },
  "exit_count": 0, //exit the process each x minutes. Used with PM2 to restart process every x minutes. 0 for no exit
  "node_port": 9000,
  "proxy_map": {
    "/api/": "api",
    "/web/": "web"
  },
  "nidcheck_endpoint": "https://nb-namecheck.glitch.me/v1/check/",
  "admin": {
    "transfer_fee": 1000,
    "transfer_fee_rate": 0.1
  },
  "tld_config": {
    "test": {
      "testing": true,
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
      "address": {
        "payment": "15Cww7izEdyr8QskJmqwC5ETqWREZCjwz4",
        "protocol": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
        "admin": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
        "other_admins": []
      },
    }
  }
}
// ------------------------------------------------------------------------------------------------

module.exports = {
  API,
  MATTERCLOUD_KEY,
  PLANARIA_TOKEN,
  NETWORK,
  TXDB,
  DMDB,
  WORKERS,
  FETCH_LIMIT,
  START_HEIGHT,
  MEMPOOL_EXPIRATION,
  ZMQ_URL,
  RPC_URL,
  CONFIG
}
