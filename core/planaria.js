/**
 * planaria.js
 *
 * Bitbus and Bitsocket API. Uses the RUN API to fetch transactions.
 *
 * Note: Bitbus does not return transactions with more than 100 outputs. Because of this,
 * some transactions may get discovered later when they are spent and will not be immediately
 * indexed by RUN. They may not also have proper heights. We recommend using MatterCloud for
 * production services.
 */

const fetch = require('node-fetch')
const AbortController = require('abort-controller')
const es = require('event-stream')
global.EventSource = require('eventsource')
const { default: ReconnectingEventSource } = require('reconnecting-eventsource')
const axios = require('axios')
//const RunConnectFetcher = require('./run-connect')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

let allPrefixes = ["1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5", "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ", "nbd"];//Util.getAllRegProtocols();

// ------------------------------------------------------------------------------------------------
// Planaria
// ------------------------------------------------------------------------------------------------

class Planaria {
    constructor(token, db, logger) {
        this.token = token
        if (!token) throw ("Planaria token missing")
        this.logger = logger
        this.db = db

        this._canResolve = true
        this.recrawlInterveral = 30000
        this.maxReorgDepth = 10
        this.network = null
        this.mempoolEvents = null
        this.recrawlTimerId = null
        this.lastCrawlHeight = null
        this.pendingReorg = false
    }

    async connect(height, network) {
        // if (network !== 'main') throw new Error(`Network not supported with Planaria: ${network}`)

        //this.runConnectFetcher.connect(height, network)

        this.txns = []
        this.abortController = new AbortController()
        this.network = "main"
        this.lastCrawlHeight = height
        this.logger.info('Crawling for new blocks via BitBus')
        await this._recrawl()
    }

    async disconnect() {
        clearTimeout(this.recrawlTimerId)

        this.abortController.abort()

        if (this.mempoolEvents) {
            this.mempoolEvents.close()
            this.mempoolEvents = null
        }
    }

    async fetch(txid) {
        let response;
        //const response = await axios.get(`https://api.run.network/v1/${this.network}/tx/${txid}`)
        let hex;
        try {
            response = await axios.get(`https://api.whatsonchain.com/v1/bsv/${this.network}/tx/${txid}/hex`)
            hex = response.data
        } catch (e) {
            response = await axios.get(`https://api.run.network/v1/${this.network}/tx/${txid}`)
            hex = response.data.hex
        }
        if (!hex) {
            console.error("Download rawtx failed");
        }
        const height = typeof response.data.blockheight === 'number' ? response.data.blockheight : null
        const time = typeof response.data.blocktime === 'number' ? response.data.blocktime : null
        return { hex, height, time }
    }

    async getNextBlock(currHeight, currHash) {
        // If we don't have that hash we're looking for next, reorg for safety
        if (currHash && this.txns.length && !this.txns.some(txn => txn.hash === currHash)) {
            this.logger.info('Reorging due to missing internal block data')
            return { reorg: true }
        }

        // Notify if we've detected a reorg
        if (this.pendingReorg) {
            this.logger.info('Detected reorg from planaria transaction data')
            this.pendingReorg = false
            return { reorg: true }
        }

        // Remove all transactions that are not realistically reorg-able
        while (this.txns.length && this.txns[0].height <= currHeight - this.maxReorgDepth) {
            this.txns.shift()
        }

        let i = 0
        while (i < this.txns.length && this.txns[i].height <= currHeight) { i++ }
        if (i === this.txns.length) return null

        const block = {
            height: this.txns[i].height,
            hash: this.txns[i].hash,
            time: this.txns[i].time,
            txids: []
        }

        while (i < this.txns.length && this.txns[i].height === block.height) {
            block.txids.push(this.txns[i].txid)
            i++
        }

        return block
    }

    async listenForMempool(mempoolTxCallback) {
        //no need to listen unconfirmed tx from blockchain
        return

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
        })
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
    canResolve() {
        return this._canResolve
    }
    async _crawl() {
        //this.logger.info('Recrawling planaria')

        const query = {
            q: {
                find: {
                    "out.s2": { "$in": allPrefixes },
                    'blk.i': { $gt: this.lastCrawlHeight - this.maxReorgDepth }
                },
                sort: { 'blk.i': 1 },
                project: { blk: 1, 'tx.h': 1 }
            }
        }

        const headers = {
            'Content-type': 'application/json; charset=utf-8',
            token: this.token
        }

        const options = {
            method: 'post',
            headers,
            body: JSON.stringify(query),
            signal: this.abortController.signal
        }
        this._canResolve = false
        return new Promise((resolve, reject) => {
            fetch('https://txo.bitbus.network/block', options)
                .then(res => {
                    // Accumulate a block's transaction into a pending list until we reach the next block
                    // or the end of the stream. That way, we don't start pulling from the block when it's
                    // only been partially added and accidentally miss transactions.
                    let pending = []

                    const addTx = json => {
                        if (!json.length) return
                        // console.log(json);
                        let data = null
                        try {
                            data = JSON.parse(json)
                        } catch (e) {
                            console.error("bitbus error. ret=", json)
                        }

                        // If there are pending transactions, check if we are on a new block
                        if (pending.length && data.blk.i > pending[0].height) {
                            this.txns = this.txns.concat(pending)
                            this.lastCrawlHeight = pending[0].height
                            pending = []
                        }

                        // Check that the transactions we are adding do not reorg
                        if (this.txns.length) {
                            const lastTx = this.txns[this.txns.length - 1]

                            // We only add txns that are add to the height
                            if (data.blk.i < lastTx.height) {
                                return
                            }

                            // Don't add transactions if we already have them
                            if (data.blk.i === lastTx.height && data.blk.h === lastTx.hash) {
                                return
                            }

                            // Check for reorgs
                            if (data.blk.i === lastTx.height && data.blk.h !== lastTx.hash) {
                                this.pendingReorg = true
                                this.txns = this.txns.slice(0, this.txns.findIndex(tx => tx.height === data.blk.h))
                            }
                        }
                        //console.log(data)
                        pending.push({ height: data.blk?.i, hash: data.blk?.h, time: data.blk?.t, txid: data.tx.h })
                    }

                    const finish = () => {
                        if (pending.length) {
                            this.txns = this.txns.concat(pending)
                            this.lastCrawlHeight = pending[0].height
                            pending = []
                        }
                        this._canResolve = true
                        resolve()
                    }

                    res.body
                        .pipe(es.split())
                        .pipe(es.mapSync(addTx))
                        .on('end', finish)
                })
                .catch(e => e.name === 'AbortError' ? resolve() : reject(e))
        })
    };
}

// ------------------------------------------------------------------------------------------------

module.exports = Planaria
