const TXO = require("./txo.js");
const { DEF } = require("./def");
const { ArUtil, Util } = require("./util")
const BitID = require('bitidentity');
const axios = require('axios')

function getChainHandler(chain) {
    let lib = null
    switch (chain) {
        case 'bsv': lib = BSVChain; break;
        case 'ar': lib = ARChain; break;
        case 'not': lib = NOTChain; break;
    }
    if (!lib) console.error("unsupported chain:", chain)
    return lib
}
class NOTChain {
    static async getAttrib({ rawtx }) {
        try {
            const tx = JSON.parse(rawtx);
            return Util.parseJson(tx.d[1])
        } catch (e) {
            return null
        }
    }
    static async raw2rtx({ rawtx, oData, time, db }) {
        const tx = Util.parseJson(rawtx);
        let rtx = {
            time: time,
            txid: tx.txid,
            publicKey: tx.pk,
            output: null,
        };
        const attrib = Util.parseJson(tx.d[1])
        rtx.ts = +attrib.ts
        if (!attrib.ts || !Number.isInteger(+rtx.ts)) {
            console.error("timestamp is missing:", rtx.txid)
            return null
        }
        let cmds = null
        if (attrib.v === 3) {
            if (!oData) oData = db.readData(attrib.hash).raw
            if (!oData) { //read from other peer
                const { Nodes } = require('./nodes')
                const d = await Nodes.getData(attrib.hash, { string: true })
                oData = d.raw
            }
            cmds = Util.parseJson(oData)
            rtx.command = cmds[2]
            const hash = await Util.dataHash(oData)
            if (hash !== attrib.hash) {
                console.error("hash mismatch:", attrib.hash)
                return null
            }
            rtx.oHash = hash
        }
        let out = [], out0 = {}, i = 2
        for (; i < cmds.length + 2; i++) {
            out0['s' + i] = cmds[i - 2]
        }
        out.push(out0)
        out.push({ protocol: "bitidentity" })
        out.push({ e: { a: "", v: 0 } })
        rtx.out = out
        rtx.chain = 'not'
        return rtx
    }
}
class ARChain {
    static async verify(rawtx, height, time, db) {
        //const v = await ARAPI.verifyTx(rawtx)
        //if(!v)return { code: 1, msg:"can not verify" }

        const rtx = await ARChain.raw2rtx({ rawtx, height, db })
        return { code: rtx ? 0 : -1, txTime: rtx && rtx.ts }
    }
    static getAttrib({ rawtx }) {
        try {
            const tx = JSON.parse(rawtx);
            let tags = tx.tags
            if (!tx.tags.nbprotocol)
                tags = ArUtil.decodeTags(tx.tags)
            const nbdata = JSON.parse(tags.nbdata)
            const attrib = JSON.parse(nbdata[1])
            if (attrib && attrib.ts) {
                if (!Number.isInteger(+attrib.ts))
                    return {}
            }
            return attrib
        } catch (e) {
            console.error(e)
            return {}
        }
    }
    static async raw2rtx({ rawtx, height, oData, db }) {
        try {
            const tx = JSON.parse(rawtx);
            let rtx = {
                height: height,
                txid: tx.id,
                publicKey: tx.owner.key ? tx.owner.key : tx.owner,
                output: null,
            };
            let tags = tx.tags
            if (!tx.tags.nbprotocol)
                tags = ArUtil.decodeTags(tx.tags)
            if (!tags) {
                console.error("tags is missing")
            }
            const nbdata = JSON.parse(tags.nbdata)
            const attrib = JSON.parse(nbdata[1])
            rtx.ts = attrib.ts
            if (!attrib.ts || !Number.isInteger(+rtx.ts)) {
                console.error("timestamp is missing:", rtx.txid)
                return null
            }
            let cmd = null
            if (attrib.v === 2) {
                cmd = Util.parseJson(tags.cmd)
                if (!cmd) {
                    if (typeof tx.data != 'undefined') cmd = JSON.parse(ArUtil.decode(tx.data))
                    else {
                        cmd = await ArUtil.getTxData(tx.id)
                    }
                }
                rtx.command = cmd[0]
            }
            if (attrib.v === 3) {
                if (!oData) {
                    oData = db.readData(attrib.hash).raw
                    if (!oData) { //read from other peer
                        const { Nodes } = require('./nodes')
                        const d = await Nodes.getData(attrib.hash, { string: true })
                        oData = d.raw
                    }
                }
                if (!oData) {
                    console.error("Cannot get OData hash:", attrib.hash, " txid:", rtx.txid)
                    return null
                }
                const hash = await Util.dataHash(oData)
                if (hash !== attrib.hash) {
                    console.error("hash mismatch:", attrib.hash)
                    return null
                }
                cmd = Util.parseJson(oData)
                //console.log("oData:", oData, "  cmd:", cmd)
                rtx.command = cmd[2]
                rtx.oHash = attrib.hash
            }
            let out = [], out0 = {}, i = 0
            for (; i < nbdata.length; i++) {
                out0['s' + i] = nbdata[i]
            }
            for (let j = 0; j < cmd.length; j++, i++) {
                out0['s' + i] = cmd[j]
            }
            out.push(out0)
            out.push({ protocol: "bitidentity" })
            if (tx.target) {
                out.push({ e: { a: tx.target, v: +tx.quantity / 10000 } })
            }
            if (tags.otherPay) {
                const oPay = Util.parseJson(tags.otherPay)
                for (const item of oPay) {
                    if (rtx.inputAddress == item.address) {
                        console.error("ar chain does not allow send to self")
                        return null
                    }
                    out.push({ e: { a: item.address, v: item.value, txid: item.txid } })
                }
            }
            rtx.out = out
            rtx.inputAddress = await Util.addressFromPublickey(rtx.publicKey, 'ar')
            if (rtx.inputAddress == tx.target) { // ar chain does not allow send to self
                console.error("ar chain does not allow send to self")
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
        try {
            let rtxVerified = BitID.verifyID(rawtx)
            if (!rtxVerified) {
                return null
            }
            let keyArray = BitID.getBitID(rawtx)
            if (keyArray.length > 0) {
                return keyArray[0].publicKey.toString()
            }
        } catch (e) {

        }
        return null
    }
    static async verify(rawtx, height, time, db) {
        const rtx = await BSVChain.raw2rtx({ rawtx, height, time: time, db })
        return { code: rtx ? 0 : -1, rtx: rtx }
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
            const len = rtx.out[0].len
            delete rtx.out[0]["s" + (len - 2)]
            delete rtx.out[0]["s" + (len - 1)]
            rtx.out[0].len -= 2
        }
    }
    static getAttrib({ rawtx }) {
        const tx = TXO.fromRaw(rawtx);
        const attrib = Util.parseJson(tx.out[0].s3)
        if (attrib && attrib.ts) {
            if (!Number.isInteger(+attrib.ts))
                return {}
        }
        return attrib ? attrib : {}
    }
    static async fetchRaw(txid) {
        let response;
        let hex;
        try {
            response = await axios.get(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`)
            hex = response.data
        } catch (e) {
            response = await axios.get(`https://api.run.network/v1/main/tx/${txid}`)
            hex = response.data.hex
        }
        if (!hex) {
            console.error("Download rawtx failed");
        }
        const height = typeof response.data.blockheight === 'number' ? response.data.blockheight : null
        const time = typeof response.data.blocktime === 'number' ? response.data.blocktime : null
        return { hex, height, time }
    }
    static async raw2rtx({ rawtx, oData, time, db }) {
        //check sig
        if (time > 1591283538 || !time) {
            const publicKey = BSVChain.verifySig(rawtx)
            if (!publicKey) {
                console.error("Failed to verify transaction signature")
                return null
            }
        }
        const tx = TXO.fromRaw(rawtx);
        let rtx = {
            time: time,
            txid: tx.tx.h,
            publicKey: tx.in[0].h1.toString(),
            output: null,
            in: tx.in,
            out: tx.out
        };
        const attrib = Util.parseJson(tx.out[0].s3)
        if (attrib && typeof attrib == "object") {
            rtx.ts = +attrib.ts
            if (attrib.v === 2) {
                rtx.command = tx.out[0].s6
            }
            if (attrib.v === 3) {
                if (!oData) {
                    oData = db.readData(attrib.hash).raw
                    if (!oData) { //read from other peer
                        const { Nodes } = require('./nodes')
                        const d = await Nodes.getData(attrib.hash, { string: true })
                        oData = d.raw
                    }
                }
                if (!oData) {
                    console.error("Cannot get OData hash:", attrib.hash, " txid:", rtx.txid)
                    return null
                }
                const hash = await Util.dataHash(oData)
                if (hash !== attrib.hash) {
                    console.error("hash mismatch:", attrib.hash)
                    return null
                }
                let cmd = Util.parseJson(oData)
                rtx.oHash = attrib.hash
                rtx.command = cmd[2]
                let j = 0, i = 4;
                for (; j < cmd.length; j++, i++) {
                    rtx.out[0]['s' + i] = cmd[j]
                }
                rtx.out[0].len += j
            }
        } else
            rtx.command = tx.out[0].s2 == "nbd" ? tx.out[0].s6 : tx.out[0].s4

        tx.in.forEach(inp => { if (inp.e.a) rtx.inputAddress = inp.e.a.toString() })
        BSVChain._reArrage(rtx)

        //TODO: check txtime
        /*if (time && rtx.ts && rtx.ts > time) {
            console.error("rtx.ts:", rtx.ts, "block_time:", block_time)
            return null
        }*/

        rtx.chain = 'bsv'
        return rtx
    }
}

module.exports.getChainHandler = getChainHandler
