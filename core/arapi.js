/**
 * NbNode.js
 *
 * NbNode API
 */

const axios = require('axios')
//global.EventSource = require('eventsource')
const { default: ReconnectingEventSource } = require('reconnecting-eventsource')

const CoinFly = require('coinfly')
const Nodes = require("./nodes")
const { Util } = require('./util')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------------
// NbNode
// ------------------------------------------------------------------------------------------------
let ar_node = null
const NumOfRecords = 1000
class AWNode {
  constructor(apiKey, db, logger) {
    this.suffix = apiKey ? `?api_key=${apiKey}` : ''
    this.logger = logger
    this.mempoolTimerID = 0
    this.lastCrawlHeight = 0
    this.lastCrawHash = null
    this.recrawlInterveral = 30000
    this.db = db
    this._canResolve = true


    ar_node = this
    //setTimeout(this._crawl.bind(this), 30000)
  }
  static async sendRawTx(rawtx) {
    if (ar_node) {
      const jsonTx = JSON.parse(rawtx)
      const tx = await ar_node.arweave.createTransaction(jsonTx)
      console.log("ar sending...")
      const response = await ar_node.arweave.transactions.post(tx);
      return { code: response.status == 200 ? 0 : 1, txid: jsonTx.id, msg: response.statusText }
    }
    return { code: 1, message: "arnode not initialized" }
  }
  static async verifyTx(rawtx) {
    if (ar_node) {
      const jsonTx = JSON.parse(rawtx)
      try {
        const tx = await ar_node.arweave.transactions.fromRaw(jsonTx)
        return await ar_node.arweave.transactions.verify(tx);
      } catch (e) {
        //console.error("verifyTx failed ar tx:",jsonTx.id)
        return false
      }
    }
    return false
  }

  async connect(height, chain) {
    if (chain !== 'ar') throw new Error(`chain not supported with NbNode: ${network}`)
    this.txs = []
    this.lib = await CoinFly.create('ar')
    this.arweave = this.lib.ar
    this.lastCrawlHeight = height

    this.logger.info('Crawling for new blocks via arweave')
    await this._recrawl()
  }

  async disconnect() {
    if (this.mempoolTimerID) {
      clearTimeout(this.mempoolTimerID)
      this.mempoolTimerID = 0
    }
  }
  async queryTx(tags, block) {
    const variables = { tags: tags, block: block }
    const query = `query Transactions($tags: [TagFilter!], $block: BlockFilter){
        transactions(tags: $tags, block:$block,first:${NumOfRecords},sort: HEIGHT_ASC) {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              owner { 
                address
                key
              }
              recipient
              tags {
                name
                value
              }
              block {
                height
                id
                timestamp
              }
              fee { winston }
              quantity { winston }
              parent { id }
            }
            cursor
          }
        }
      }`;

    const response = await this.lib.graphQL({
      query, variables
    });
    //    console.log(response.data)
    return response.data.data ? response.data.data.transactions : null
  }
  canResolve() {
    return this._canResolve
  }
  async fetch(txid) {
    //const tx = await this.arweave.transactions.get(txid)
    console.log("ar: fetching ", txid, " return null")
    const tx = this.db.getTransaction(txid, 'ar')
    let rawtx = ""
    if (tx && tx.bytes) rawtx = tx.bytes.toString()
    if (!rawtx) {
      const res = await axios.get("https://arweave.net/tx/" + txid)
      if (res.data) {
        rawtx = JSON.stringify(res.data)
      }
    }
    if (tx) {
      return { hex: rawtx, height: tx.height, time: tx.time }
    }
    return { hex: null, height: 0, time: 0 }
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
    const txs = await this.queryTx({ name: "nbprotocol", values: ["nbd"] }, { min: height })
    if (!txs) return;
    this._canResolve = false
    let bigHeight = height;
    for (let item of txs.edges) {
      let height = item.node.block && item.node.block.height
      if (height > bigHeight) { bigHeight = height }
      if (item.node.id == "xQqnCdHnJkYXJoIsbdnHFucOVo6RVPZfNYYzwLlsmLU") {
        console.log("ar crawl found")
      }
      if (this.db.isTransactionParsed(item.node.id, 'ar')) continue

      let time = item.node.block && item.node.block.timestamp
      let block = this.txs.find(bl => bl.height === height)
      let newBlock = false
      if (!block) {
        block = { height: height, time: time, hash: item.node.block.id, txids: [], txhexs: [] }
        newBlock = true
      }

      let tags = {}
      item.node.tags.forEach(tag => tags[tag.name] = tag.value)
      item.node.tags = tags
      /* if (!tags.cmd) {
         try {
           const data = await this.lib.getData(item.node.id, { decode: false, string: true })
           if (data) item.node.data = data
         } catch (e) {
           const d = await Nodes.getData(item.node.id, 'ar')
           if (d) {
             console.log("got from peers")
             item.node.data = d
           } else
             console.error(e.message + " txid:", item.node.id)
         }
 
       }*/
      block.txids.push(item.node.id)
      block.txhexs.push(JSON.stringify(item.node))
      if (newBlock)
        this.txs.push(block)
    }
    this._canResolve = true
    try {
      const current = await this.arweave.blocks.getCurrent();
      if (current) {
        this.lastCrawHash = "unknown"
        if (current.height < bigHeight) {
          this.lastCrawHash = bigHeight
        } else {
          this.lastCrawlHeight = bigHeight + NumOfRecords
          if (this.lastCrawlHeight > current.height) {
            this.lastCrawlHeight = current.height
            this.lastCrawHash = current.hash
          }
        }
      }
    } catch (e) {
      console.error("arapi._crawl:", e.code)
      const arnodes = ["http://gateway-2.arweave.net:1984", "http://gateway-3.arweave.net:1984", "http://gateway-2.arweave.net:1984", "https://www.arweave.net"]
      this.lib.changeNode(arnodes[Math.floor(Math.random() * 10 % 4)]);
    }
  }
  async getNextBlock(currHeight, currHash) {
    try {
      if (this.txs.length > 0)
        return this.txs.shift()

      return { height: this.lastCrawlHeight, hash: this.lastCrawHash, txids: [], txhexs: [] }
    } catch (e) {
      console.log(e)
      throw e
    }
  }

  async listenForMempool(mempoolTxCallback) {
    /*  const txs = await this.queryTx({ name: "protocol", values: ["nbtest2"] }, { max: 0 })
      console.log(txs);
      for (let item of txs.edges) {
        mempoolTxCallback(item.node.id, item.node)
      }*/
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = AWNode
