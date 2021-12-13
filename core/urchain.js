/**
 * UrChain.js
 *
 * UrChain API
 */

const axios = require('axios')
const bsv = require('bsv')
global.EventSource = require('eventsource')
const { default: ReconnectingEventSource } = require('reconnecting-eventsource')
const RunConnectFetcher = require('./run-connect')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const NB_FILTERS = [
  { filter: "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5", start: 613645, end: 709550}, //1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5
  { filter: "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ", start: 658653, end: 709550 }, //14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ
  { filter: "nbd", start: 696101, end: 999999999 }  //nbd
]

// ------------------------------------------------------------------------------------------------
// UrChain
// ------------------------------------------------------------------------------------------------

class UrChain {
  constructor(apiKey, logger) {
    this.suffix = apiKey ? `?api_key=${apiKey}` : ''
    this.logger = logger
    this.mempoolTimerID = 0
    this.lastCrawlHeight = 0
    this.recrawlInterveral = 30000
    this.runConnectFetcher = new RunConnectFetcher()
    this.txs = []
    setTimeout(this._crawl.bind(this),30000)
  }

  async connect(height, network) {
    if (network !== 'main') throw new Error(`Network not supported with UrChain: ${network}`)
    this.lastCrawlHeight = height
    this.runConnectFetcher.connect(height, network)
    this.logger.info('Crawling for new blocks via urChain')
    await this._recrawl()
  }

  async disconnect() {
    if (this.mempoolTimerID) {
      clearTimeout(this.mempoolTimerID)
      this.mempoolTimerID = 0
    }
  }

  async fetch(txid) {
    return await this.runConnectFetcher.fetch(txid)
  }
  async _recrawl() {
    const scheduleRecrawl = () => {
        this.recrawlTimerId = setTimeout(this._recrawl.bind(this), this.recrawlInterveral)
    }

    return this._crawl()
        .then(() => {
            scheduleRecrawl()
        })
        .catch(e => {
            this.logger.error(e)
            this.logger.info('Retrying crawl in ' + this.recrawlInterveral / 1000 + ' seconds')
            scheduleRecrawl()
        })
}
  async _crawl(){
    let height = this.lastCrawlHeight+1

    for (let i = 0; i < NB_FILTERS.length; i++) {
      const FILTER = NB_FILTERS[i]
      if (height < FILTER.start || height > FILTER.end) continue
      const url = `https://urchain.com/v0/protocol/${FILTER.filter}?height=${height}`
      const response = await axios.get(url)
      //console.log(response.data);
      if (response.data.success === true) {
        for (let item of response.data.result) {
          if(this.lastCrawlHeight<item.height)this.lastCrawlHeight = item.height
          let block = this.txs.find(bl=>bl.height === item.height)
          if(!block){
              block = {height:item.height,hash:null,txids:[]}
              this.txs.push(block)
          }
          block.txids.push(item.txId)
        }
      }
    } 
  }
  async getNextBlock(currHeight, currHash) {
    const height = currHeight + 1
    try {
      return this.txs.pop()
    } catch (e) {
      console.log(e)
      throw e
    }
  }

  async listenForMempool(mempoolTxCallback) {
    return new Promise(resolve=>{
      this.logger.info('Listening for mempool via UrChain')
      this.mempoolTimerID = setTimeout(async function checkMempool(){
      const url = `https://urchain.com/v0/protocol/nbd?height=0`
      const response = await axios.get(url)
      if (response.data.success === true) {
        let found = false
        for (let item of response.data.result) {
          console.log("found mempool tx:",item.txId)
          mempoolTxCallback(item.txId,null)
          found = true
        }
        if(found){
          resolve()
          return
        }
      }
      this.mempoolTimerID = setTimeout(checkMempool,10000)
    },10000)
    })
    
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = UrChain
