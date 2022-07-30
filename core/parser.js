const { Parser_Domain } = require('./parser_domain')
const { Parser_NFT } = require('./parser_nft');
const { ARChain, BSVChain } = require('./chains.js');
const { CMD } = require('./def');

const parsers = {}
class Parser {
    static init(db) {
        this.domainParser().init(db)
        this.nftParser().init(db)
        this.db = db
    }
    static async parse({ rawtx, oData, height, time, chain }) {
        let rtx = (chain === 'ar' ? await ARChain.raw2rtx({ rawtx, oData, height, time, db: this.db }) : await BSVChain.raw2rtx({ rawtx, oData, height, time, db: this.db }))
        return { code: rtx ? 0 : 1, rtx: rtx }
    }
    static domainParser() {
        if (!this.parser_domain) this.parser_domain = new Parser_Domain()
        return this.parser_domain
    }
    static nftParser() {
        if (!this.parser_nft) this.parser_nft = new Parser_NFT()
        return this.parser_nft
    }
    static getAttrib({ rawtx, chain }) {
        return chain === 'ar' ? ARChain.getAttrib({ rawtx }) : BSVChain.getAttrib({ rawtx })
    }
    static async parseTX({ rawtx, oData, height, time, chain, newTx = false }) {
        const ret = await this.parse({ rawtx, oData, height, time, chain })
        if (ret.code != 0) {
            return { code: 1, msg: "invalid rawtx format" }
        }
        const rtx = ret.rtx
        try {
            if (newTx) { //new rawtx
                const tsNow = Date.now() / 1000
                const tspan = tsNow - rtx.ts
                if (tspan > 120 || tspan < -1) {
                    console.error("invalid timestamp:tspan=", tspan, " tsNow:", tsNow, " ts:", rtx.ts)
                    return { code: 1, msg: "invalid timestamp" }
                }
            }
            if (rtx.ts) rtx.time = rtx.ts
            let handler = this.domainParser().getHandler(rtx.command)
            if (!handler) handler = this.nftParser().getHandler(rtx.command)
            if (handler) rtx.output = await handler.parseTX(rtx, newTx)
            if (!handler) {
                console.error("no handler for command:", rtx.command)
            }
            delete rtx.in
            delete rtx.out
            if (!rtx.output) {
                return { code: -1, msg: `Not a valid output: ${rtx.txid}` };
            }
        } catch (e) {
            console.error(e)
            if (!rtx.output) rtx.output = {}
            rtx.output.err = e.message
        }
        return rtx.output.err ? { code: -1, msg: rtx.output.err } : { code: 0, rtx: rtx }
    }
    static async fillObj(nidObj, rtx, objMap) {
        let retObj = null
        nidObj.last_txid = rtx.txid
        nidObj.last_ts = rtx.ts ? rtx.ts : rtx.time
        nidObj.last_cmd = rtx.command

        if (rtx.output.err) {
            return null
        }
        let handler = this.domainParser().getHandler(rtx.command)
        if (!handler) handler = this.nftParser().getHandler(rtx.command)
        if (handler) retObj = await handler.fillObj(nidObj, rtx, objMap)
        else {
            console.error(rtx.command, ":No handler found")
        }
        if (retObj == null) {
            console.error("Skipped one tx:", "msg:", rtx.output.err, rtx.command, " txid:", rtx.txid)
            return null
        }
        console.log("applying cmd", rtx.command, " to:", nidObj.domain)
        if (rtx.command === CMD.REGISTER) {
            nidObj.reg_ts = nidObj.last_ts
        }
        return JSON.parse(JSON.stringify(retObj))
    }
}
module.exports = Parser