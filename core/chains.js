const TXO = require("./txo.js");
const { DEF } = require("./def");
const { ArUtil, Util } = require("./util")
const BitID = require('bitidentity');
const ARAPI = require('./arapi')

class ARChain {
    static async verify(rawtx, height) {
        //const v = await ARAPI.verifyTx(rawtx)
        //if(!v)return { code: 1, msg:"can not verify" }

        const rtx = await ARChain.raw2rtx({ rawtx, height })
        return { code: rtx ? 0 : 1, txTime: rtx.ts }
    }
    static async raw2rtx({ rawtx, height, oData, db }) {
        try {
            const tx = JSON.parse(rawtx);
            let tags = tx.tags
            if (!tx.tags.nbprotocol)
                tags = ArUtil.decodeTags(tx.tags)
            if (!tags) {
                console.error("tags is missing")
            }
            const nbdata = JSON.parse(tags.nbdata)
            const attrib = JSON.parse(nbdata[1])
            const ts = attrib.ts
            let cmd = null
            if (attrib.v === 2) {
                cmd = Util.parseJson(tags.cmd)
                if (!cmd) {
                    if (typeof tx.data != 'undefined') cmd = JSON.parse(ArUtil.decode(tx.data))
                    else {
                        cmd = await ArUtil.getTxData(tx.id)
                    }
                }
            }
            if (attrib.v === 3) {
                if (!oData) { //TODO: got oData from hash
                    oData = db.readData(attrib.hash)
                }
                cmd = Util.parseJson(oData)
            }
            let out = [], out0 = { e: {} }, i = 0
            for (; i < nbdata.length; i++) {
                out0['s' + i] = nbdata[i]
            }
            for (let j = 0; j < cmd.length; j++, i++) {
                out0['s' + i] = cmd[j]
            }
            out.push(out0)
            tx.tags = tags
            let rtx = {
                height: height,
                ts: +ts,
                txid: tx.id,
                publicKey: tx.owner.key ? tx.owner.key : tx.owner,
                command: cmd[0],
                output: null,
                out: out,
            };
            rtx.inputAddress = await Util.addressFromPublickey(rtx.publicKey, 'ar')
            if (rtx.inputAddress == tx.target) { // ar chain does not allow send to self
                return null
            }
            rtx.chain = 'ar'
            return rtx
        } catch (e) {
            console.error(e)
            console.log("error rawtx:")
            console.log(rawtx)
            return null
        }
    }
}
class BSVChain {
    static verifySig(rawtx) { //retuen publicKey or null
        let rtxVerified = BitID.verifyID(rawtx)
        if (!rtxVerified) {
            return null
        }
        let keyArray = BitID.getBitID(rawtx)
        if (keyArray.length > 0) {
            return keyArray[0].publicKey.toString()
        }
        return null
    }
    static async verify(rawtx, height, block_time) {
        let txTime = null
        if (!height || height == -1 || height > DEF.BLOCK_SIGNATURE_UPDATE) {
            const publicKey = BSVChain.verifySig(rawtx)
            if (!publicKey) {
                return { code: -1, msg: `Failed to verify transaction signature.` }
            }
        }
        if (block_time) { //check txtime
            const rtx = await BSVChain.raw2rtx({ rawtx, height, time: block_time })
            txTime = rtx.ts
            if (rtx.ts && rtx.ts > block_time)
                return { code: -1, msg: 'txTime invalid' }
        }
        return { code: 0, txTime: txTime }
    }
    static _reArrage(rtx) {
        if (rtx.out[0].s2 === "nbd") {
            for (let i = 2; i < rtx.out[0].len; i++) {
                rtx.out[0]["s" + (i + 2)]
                    ? (rtx.out[0]["s" + i] = rtx.out[0]["s" + (i + 2)])
                    : "";
                rtx.out[0]["b" + (i + 2)]
                    ? (rtx.out[0]["b" + i] = rtx.out[0]["b" + (i + 2)])
                    : "";
                rtx.out[0]["h" + (i + 2)]
                    ? (rtx.out[0]["h" + i] = rtx.out[0]["h" + (i + 2)])
                    : "";
                rtx.out[0]["f" + (i + 2)]
                    ? (rtx.out[0]["f" + i] = rtx.out[0]["f" + (i + 2)])
                    : "";
            }
        }
    }
    static async raw2rtx({ rawtx, oData, height, time, db }) {
        const tx = TXO.fromRaw(rawtx);
        let rtx = {
            height: height,
            time: time,
            txid: tx.tx.h,
            publicKey: tx.in[0].h1.toString(),

            output: null,
            in: tx.in,
            out: tx.out,
            ts: 0,
        };
        const attrib = Util.parseJson(tx.out[0].s3)
        if (attrib) {
            rtx.ts = +attrib.ts
            if (attrib.v === 2) {
                rtx.command = tx.out[0].s6
            }
            if (attrib.v === 3) {
                if (!oData) { //TODO: got oData from hash
                    oData = db.readData(attrib.hash)
                }
                let cmd = Util.parseJson(oData)
                rtx.oHash = attrib.hash
                rtx.command = cmd[2]
                rtx.out[0].s4 = cmd[0]
                rtx.out[0].s5 = cmd[1]
                rtx.out[0].s6 = cmd[2]
                rtx.out[0].s7 = cmd[3]
                rtx.out[0].len += 4
            }
        } else
            rtx.command = tx.out[0].s2 == "nbd" ? tx.out[0].s6 : tx.out[0].s4

        tx.in.forEach(inp => { if (inp.e.a) rtx.inputAddress = inp.e.a.toString() })
        BSVChain._reArrage(rtx)
        rtx.chain = 'bsv'
        return rtx
    }
}

module.exports = {
    ARChain, BSVChain
}