/**
 * NbNode.js
 *
 * NbNode API
 */

const axios = require('axios')
const bsv = require('bsv')
global.EventSource = require('eventsource')
const { default: ReconnectingEventSource } = require('reconnecting-eventsource')
const RunConnectFetcher = require('./run-connect')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------------
// NbNode
// ------------------------------------------------------------------------------------------------

class NbNode {
  constructor(apiKey, logger) {
    this.suffix = apiKey ? `?api_key=${apiKey}` : ''
    this.logger = logger
    this.mempoolTimerID = 0
    this.lastCrawlHeight = 0
    this.recrawlInterveral = 30000
    this.runConnectFetcher = new RunConnectFetcher()
    this.txs = []
    this.apiURL = 'https://tnode.nbdomain.com'
    setTimeout(this._crawl.bind(this), 30000)
  }

  async connect(height, network) {
    if (network !== 'main') throw new Error(`Network not supported with NbNode: ${network}`)
    this.runConnectFetcher.connect(height, network)
    this.lastCrawlHeight = height

    this.logger.info('Crawling for new blocks via NbNode')
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
  async _crawl() {
    let height = this.lastCrawlHeight + 1

    const url = this.apiURL + "/api/queryTX?from=" + height
    const response = await axios.get(url)
    //console.log(response.data);

    for (let item of response.data) {
      if (this.lastCrawlHeight < item.height) this.lastCrawlHeight = item.height
      let block = this.txs.find(bl => bl.height === item.height)
      if (!block) {
        block = { height: item.height, hash: null, txids: [], txhexs: [] }
        this.txs.push(block)
      }
      block.txids.push(item.txid)
      block.txhexs.push(item.rawtx)
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
  /*  let allPrefixes = ["1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5","14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ","nbd"];//Util.getAllRegProtocols();
    this.logger.info('Listening for mempool via BitSocket')

    const query = {
        v: 3,
        q: {
            find: {
                "out.s2": { "$in": allPrefixes }
                //'out.h3': NBD_VERSION
            },
            project: { 'tx.h': 1 }
        }
    }

    const b64query = Buffer.from(JSON.stringify(query), 'utf8').toString('base64')

    return new Promise((resolve, reject) => {
        const url = `https://txo.bitsocket.network/s/${b64query}`

        this.mempoolEvents = new ReconnectingEventSource(url)

        this.mempoolEvents.onerror = (e) => reject(e)

        this.mempoolEvents.onmessage = event => {
            if (event.type === 'message') {
                const data = JSON.parse(event.data)

                if (data.type === 'open') {
                    resolve()
                }

                if (data.type === 'push') {
                    for (let i = 0; i < data.data.length; i++) {
                        mempoolTxCallback(data.data[i].tx.h, null)
                    }
                }
            }
        }
    })*/
}
  /*async listenForMempool(mempoolTxCallback) {
    console.log("checking mempool via urchain")
    const url = `https://urchain.com/v0/protocol/nbd?height=0`
    const response = await axios.get(url)
    if (response.data.success === true) {
      for (let item of response.data.result) {
        console.log("found mempool tx:", item.txId)
        mempoolTxCallback(item.txId, null)
      }
    }
  }*/
}

// ------------------------------------------------------------------------------------------------

module.exports = NbNode
