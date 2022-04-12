const { Parser_Domain } = require('./parser_domain')
const { Parser_NFT } = require('./parser_nft');
const { ARChain, BSVChain } = require('./chains.js')

const parsers = {}
class Parser {
    static get(chain) {
        if (chain == 'bsv') {
            if (!parsers.bsv) parsers.bsv = new Parser('bsv')
            return parsers.bsv
        }
        if (chain == 'ar') {
            if (!parsers.ar) parsers.ar = new Parser('ar')
            return parsers.ar
        }
        throw ("Unsupported chain")
    }
    constructor(chain) {
        this.chain = chain
        this.parser_domain = new Parser_Domain(chain)
        this.parser_nft = new Parser_NFT(chain)
    }
    init(db) {
        this.parser_domain.init(db)
        this.parser_nft.init(db)
        this.db = db
    }
    async verify({ rawtx, oData, height, time }) {
        let rtx = (this.chain === 'ar' ? await ARChain.raw2rtx({ rawtx, oData, height, time, db: this.db }) : await BSVChain.raw2rtx({ rawtx, oData, height, time, db: this.db }))
        return { code: rtx ? 0 : 1, rtx: rtx }
    }
    domainParser() {
        /*switch(this.chain){
            case 'bsv': return Parser_Domain
            case 'ar': return AR_Parser_Domain
        }
        return null*/
        return this.parser_domain
    }
    nftParser() {
        /* switch(this.chain){
             case 'bsv': return Parser_NFT
             case 'ar': return null
         }*/
        return this.parser_nft
    }
    getAttrib({ rawtx }) {
        return this.chain === 'ar' ? ARChain.getAttrib({ rawtx }) : BSVChain.getAttrib({ rawtx })
    }
    async parseRaw({ rawtx, oData, height, time, verify = false }) {

        //let rtx = (this.chain === 'ar' ? await ARChain.raw2rtx({ rawtx, oData, height, time, db: this.db }) : await BSVChain.raw2rtx({ rawtx, oData, height, time, db: this.db }))
        const ret = await this.verify({ rawtx, oData, height, time })
        if (ret.code != 0) {
            return { code: 1, msg: "invalid rawtx format" }
        }
        const rtx = ret.rtx
        try {
            if (verify && height == -1) { //p2p rawtx
                const tsNow = Date.now() / 1000
                const tspan = tsNow - rtx.ts
                if (tspan > 120 || tspan < -1) {
                    console.error("invalid timestamp:tspan=", tspan, " tsNow:", tsNow, " ts:", rtx.ts)
                    return { code: 1, msg: "invalid timestamp" }
                }
            }
            let handler = this.domainParser().getHandler(rtx.command)
            if (!handler) handler = this.nftParser().getHandler(rtx.command)
            if (handler) rtx.output = await handler.parseTX(rtx, verify)
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
        return { code: 0, obj: rtx, msg: rtx.output.err ? rtx.output.err : "success" }
    }
    async fillObj(nidObj, rtx, objMap) {
        let retObj = null
        nidObj.lastUpdateheight = rtx.height;
        nidObj.last_txid = rtx.txid
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
        return JSON.parse(JSON.stringify(retObj))
    }
}
module.exports = Parser