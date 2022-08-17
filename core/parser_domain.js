
const { Util, CMD_BASE } = require("./util.js");
const { CMD, MemDomains, DEF } = require("./def")
const { DomainTool } = require('./domainTool')

class Parser_Domain {
    constructor() {
    }
    init(db) {
        this.db = db;
    }
    parse(rtx) {
        let ret = {
            code: -1, msg: ""
        }
        try {
            const handler = this.getHandler(rtx.command)
            if (handler) {
                rtx.output = handler.parseTX(rtx)
            }
            if (!rtx.output) {
                ret.msg = `Not a valid output: ${rtx.txid}`;
                return ret;
            }
        } catch (err) {
            ret.msg = err.message;
            console.error(err);
            return ret;
        }
        if (rtx.output.err) {
            console.error("parse domain:", rtx.output.err)
        }
        ret.code = 0;
        ret.obj = rtx;
        return ret;
    }
    getHandler(command) {
        const handler = this.getAllCommands()[command]
        if (handler) {
            handler.parser = this
            return handler
        }
        return null
    }
    getAllCommands() {
        return {
            [CMD.KEY]: CMD_KEY, [CMD.USER]: CMD_USER, [CMD.NOP]: CMD_NOP, [CMD.REGISTER]: CMD_REGISTER, [CMD.PAY_REGISTER]: CMD_PAY_REGISTER,
            [CMD.BUY]: CMD_BUY, [CMD.SELL]: CMD_SELL, [CMD.ADMIN]: CMD_ADMIN, [CMD.TRANSFER]: CMD_TRANSER, [CMD.MAKE_PUBLIC]: CMD_MAKE_PUBLIC,
        }
    }
}
class CMD_USER {
    static async parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            if (rtx.out[0].s5 == 'v1') {
                const extra = Util.parseJson(rtx.out[0].s6)
                if (!extra) {
                    output.err = "Wrong add_user format"
                    return output
                }
                if (!extra.name || !extra.publicKey) {
                    output.err = "name or publicKey missing"
                }
                extra.address = await Util.addressFromPublickey(extra.publicKey, extra.chain || rtx.chain)
                output.extra = extra
                return output
            }
        } catch (e) {
            console.error("CMD_USER.parseTX:", e.message)
        }
        output.err = "Wrong User format"
        return output
    }
    static async fillObj(nidObj, rtx) {
        const output = rtx.output
        if (!nidObj.users) nidObj.users = {}
        const name = output.extra.name
        delete output.extra.name
        nidObj.users[name] = output.extra
        nidObj.users[name].txid = rtx.txid
        nidObj.users[name].uid = await Util.dataHash(name + "@" + nidObj.domain + output.extra.address)
        return nidObj
    }
}
class CMD_PAY_REGISTER {
    static parseTX(rtx) {
        let output = {}
        output.protocol = rtx.out[0].s2;
        output.nid = rtx.out[0].s3.toLowerCase();
        const tld = Util.getRegisterProtocolFromPayment(output.protocol)[0];
        output.domain = output.nid + "." + tld
        return output;
    }
    static fillObj(nidObj, rtx) {

        return nidObj
    }
}
class CMD_MAKE_PUBLIC {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        return output;
    }
    static fillObj(nidObj, rtx) {
        try {
            if (nidObj.owner_key == null) return null
            if (nidObj.owner_key == rtx.publicKey) {
                nidObj.status = DEF.STATUS_PUBLIC
            }
        } catch (e) {

        }
        return nidObj
    }
}
class CMD_REGISTER {
    static async parseTX(rtx, newTx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            const domain = output.domain
            if (domain == "10200.test") {
                console.log("found")
            }
            if (rtx.out[0].s5 == 'v2') {
                output.owner_key = rtx.publicKey
                if (rtx.ts && rtx.ts > 2653635945) { //enforce price check after this time
                    const payment = +rtx.out[2].e.v
                    const resp = await DomainTool.fetchDomainPrice(domain, this.parser.db, newTx)
                    if (resp.code != 0 || !resp.price) {
                        output.err = domain + " cannot be registered"
                        return output
                    }
                    if (+resp.price > payment) {
                        output.err = `More than ${resp.price} needs to be paid to purchase the domain.`;
                        return output;
                    }
                }
                let attrib = Util.parseJson(rtx.out[0].s6)
                if (attrib && attrib.toKey) {
                    output.owner_key = attrib.toKey
                }
            } else {//TODO: add end time check for old format
                let addr = await Util.addressFromPublickey(rtx.publicKey, rtx.chain);
                let authorsities = Util.getAdmins(output.protocol, rtx.time);
                if (!authorsities.includes(addr)) {
                    output.err = "Input address not in authorities.";
                }
                output.owner_key = rtx.out[0].s5;
                if (!output.owner_key) output.owner_key = rtx.publicKey
                if (rtx.out[0].s6) {
                    const extra = Util.parseJson(rtx.out[0].s6);
                    if (extra)
                        output.payTx = extra["pay_txid"];
                }
                if (rtx.out[0].s7) output.agent = rtx.out[0].s7;
            }

        } catch (err) {
            console.error(rtx.txid)
            console.log(err)
            output.err = "Invalid format for RegisterOutput class."
            return output
        }
        if (output.owner_key == null || output.owner_key == "") {
            output.err = "Invalid format for RegisterOutput class1."
            return output
        }
        return output
    }
    static async fillObj(nidObj, rtx) {
        try {
            if (nidObj.owner_key) {
                rtx.output.err = nidObj.domain + ": Already registered"
                return null
            }//can't register twice
            nidObj.nid = rtx.output.nid;
            nidObj.owner_key = rtx.output.owner_key;
            nidObj.owner = await Util.addressFromPublickey(nidObj.owner_key, rtx.chain);
            nidObj.txid = rtx.txid;
            nidObj.status = DEF.STATUS_VALID;
            nidObj.domain = rtx.output.domain;
        } catch (e) {
            rtx.output.err = e.message
            return null //some data is invalid, probably owner_key is not a valid public key
        }
        return nidObj
    }
}
class CMD_BUY {
    static async parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            if (output.domain == "100019.b") {
                console.log("found")
            }
            let extra = null;
            if (rtx.out[0].s5 == "v2") {
                extra = Util.parseJson(rtx.out[0].s6);
                output.v = 2
                output.sellDomain = extra.domain
                output.agent = rtx.out[0].s7;
            } else { //TODO: add end time limitation for old format
                if (rtx.inputAddress != "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5" && rtx.inputAddress != '14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ' && rtx.inputAddress != '1KEjuiwj5LrUPCswJZDxfkZC8iKF4tLf9H') {
                    output.err = "Wrong Buy format:" + output.domain
                    return output
                }
                extra = JSON.parse(rtx.out[0].s6)
                output.v = 1
                output.newOwner = rtx.out[0].s5
                output.sellDomain = output.domain
                //no need to verify since it's verified by admin
                /*let ret = this.parser.db.loadDomain(output.sellDomain)
                if (!ret || !ret.sell_info) {
                    output.err = output.sellDomain + " is not onsale."
                }*/
                return output
            }
            output.sell_txid = extra.sell_txid;

            const pay1 = rtx.out[2].e
            const pay2 = rtx.out[3].e
            //TODO: move to fillobj
            let ret = this.parser.db.loadDomain(output.sellDomain)
            if (ret && ret.sell_info) {
                const delta = Math.abs(ret.sell_info.price - pay1.v)
                if (delta > 10) {
                    output.err = "not enough payment for:" + output.sellDomain
                    return output
                }
                const paymentAddress = Util.getPaymentAddr({ tld: output.sellDomain.split('.')[1] })
                if (paymentAddress != pay2.a) {
                    output.err = "wrong fee payment address:" + output.sellDomain
                    return output
                }
            } else {
                output.err = output.sellDomain + "is not onsale"
                return output
            }
            //output.owner_key = rtx.publicKey;
        } catch (err) {
            output.err = "Invalid format for BuyOutput class."
            return output
        }
        return output
    }
    static async fillObj(nidObj, rtx, objMap) {
        if (nidObj.domain == "100860.b") {
            console.log("found")
        }
        if (nidObj.owner_key == null) return null
        const sellDomain = rtx.output.sellDomain
        let obj = this.parser.db.loadDomain(sellDomain)
        if (!obj || !obj.sell_info) {
            console.error(sellDomain + " is not onsale")
            return null
        }
        await Util.resetNid(obj, rtx.output.newOwner ? rtx.output.newOwner : nidObj.owner_key, rtx.txid, DEF.STATUS_VALID, obj.sell_info.clear_data, rtx.chain);
        objMap[sellDomain] = obj
        console.log("bought:", sellDomain)
        return nidObj
    }
}
class CMD_SELL {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            if (output.domain == "100014.a") {
                console.log("found")
            }
            var extra = JSON.parse(rtx.out[0].s5);
            output.buyer = extra["buyer"];
            output.note = extra["note"];
            output.price = Number(extra["price"]);
            output.expire = Number(extra["expire"]);
            output.clear_data = extra["clear_data"];
        } catch (err) {
            output.err = "Invalid format for SellOutput class."
        }
        return output
    }
    static async fillObj(nidObj, rtx) {
        if (nidObj.domain == "100014.a") {
            console.log("found")
        }
        if (nidObj.owner_key == null) return null
        if (nidObj.owner_key == rtx.publicKey) {
            nidObj.status = DEF.STATUS_TRANSFERING
            nidObj.sell_info = {
                price: rtx.output.price,
                buyer: rtx.output.buyer,
                expire: rtx.output.expire,
                note: rtx.output.note,
                clear_data: rtx.output.clear_data,
                seller: await Util.addressFromPublickey(rtx.publicKey, rtx.chain), //Util.getAddressFromPublicKey(rtx.publicKey).toString(),
                sell_txid: rtx.txid
            };
            nidObj.tf_update_tx = rtx.txid;
        } else {
            console.error("Wrong owner for sell command")
            return null
        }
        return nidObj
    }
}
class CMD_NOP {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        return output
    }
    static fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null) return null
        return nidObj
    }
}
class CMD_TRANSER {
    static async parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            output.owner_key = rtx.out[0].s5.toLowerCase();
            // output.transfer_fee = rtx.out[3].e.v;
            // output.payment_addr = rtx.out[3].e.a;
            //Util.getAddressFromPublicKey(output.owner_key) //test public key
            await Util.addressFromPublickey(output.owner_key, rtx.chain)
        } catch (err) {
            output.err = "Invalid format for Transfer command."
            return output
        }
        //  if (output.transfer_fee < 1000) {
        //      output.err = "Transfer command must pay admin fee 1000 satoshi."
        //      return output
        //  }

        return output
    }
    static async fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null) return null
        try {
            if (nidObj.owner_key == rtx.publicKey) {
                //nidObj = DomainTool.updateNidObjFromRX(nidObj, rtx)
                nidObj.owner_key = rtx.output.owner_key;
                nidObj.owner = await Util.addressFromPublickey(rtx.output.owner_key)//Util.getAddressFromPublicKey(rtx.output.owner_key).toString();
            }
        } catch (e) {
            console.error("fillObj: Transfer command invalid")
            return null
        }
        return nidObj
    }
}
class CMD_ADMIN {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            var extra = JSON.parse(rtx.out[0].s5);
            output.key = Object.keys(extra)[0];
            output.value = extra[output.key];
        } catch (err) {
            output.err = "Invalid format for MetaDataOutput class."
        }
        return output
    }
    static fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null) return null
        if (nidObj.owner_key == rtx.publicKey)
            //nidObj = DomainTool.updateNidObjFromRX(nidObj, rtx);
            nidObj.admins = rtx.output.value;
        nidObj.admin_update_tx = rtx.txid;
        return nidObj
    }
}
class CMD_KEY {
    static verify(rtx, output) {
        let err = null
        if (output.domain == "10200.test") {
            console.log("found")
        }
        const obj = this.parser.db.loadDomain(output.domain)
        if (!obj) { err = "CMD_KEY: domain not exist"; return err; }
        if (obj.owner_key != rtx.publicKey) {
            for (const name in obj.users) { //check users
                if (obj.users[name].publicKey == rtx.publicKey) {
                    output.user = name
                    return 1
                }
            }
            for (const name in obj.admins) {
                const adminAddress = obj.admins[name];
                if (adminAddress == rtx.inputAddress) {
                    return 1
                }
            }
            err = "CMD_KEY: no access"

        }
        if (err) {
            console.error(err)
            return err
        }
        return 1
    }
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            let tags = null, pay = {}, hasPay = false
            output.value = JSON.parse(rtx.out[0].s5);
            const s6 = Util.parseJson(rtx.out[0].s6)
            tags = s6 && s6.tags;
            if (tags) rtx.command == "key"
                ? (output.tags = tags)
                : (output.utags = tags);

            output.ts = rtx.ts ? rtx.ts : rtx.time
            output.txid = rtx.txid
            for (const out of rtx.out) {
                if (out.e && out.e.a && out.e.a != rtx.inputAddress) {
                    pay[out.e.a] = out.e.v
                    hasPay = true
                }
            }
            if (hasPay)
                output.pay = pay
            //only verify tx related
            /*const err = this.verify(rtx, output)
            if (err != 1)
                output.err = err*/
        } catch (e) {
            output.err = e.message
        }
        if (typeof output.value != "object") {
            output.err = "Invalid value of key:" + output.value
        }
        return output;
    }
    static updateKeyAndHistory(obj, key, newValue, output) {
        if (key == "todomain") return false//'todomain' is not a key
        const oldvalue = obj.keys[key]
        if (oldvalue) {
            this.parser.db.saveKeyHistory(obj, key, oldvalue);
        }
        let newKey = { value: newValue, txid: output.txid };
        if (output.user) {
            newKey.from = output.user
            key = key + '.*' + output.user
        }
        if (output.ts) newKey.ts = output.ts;
        if (output.pay) newKey.pay = output.pay;
        if (output.tags) {
            newKey.tags = output.tags
            obj.tag_map[key + '.'] = output.tags;
        }

        obj.keys[key] = newKey;
        return true
    }
    static async fillObj(nidObj, rtx, objMap) {
        if (nidObj.owner_key == null) {
            rtx.output.err = "No owner"
            return null
        }
        if (this.verify(rtx, rtx.output) != 1) return null
        if (rtx.output?.value?.toDomain) {
            let obj = objMap[rtx.output.value.toDomain]
            if (!obj) {
                obj = this.parser.db.loadDomain(rtx.output.value.toDomain)
                objMap[rtx.output.value.toDomain] = obj
            }
            if (obj && obj.status == DEF.STATUS_PUBLIC) {
                for (const key in rtx.output.value) {
                    let newKey = key.toLowerCase()
                    let newValue = rtx.output.value[key]
                    if (CMD_KEY.updateKeyAndHistory(obj, newKey, newValue, rtx.output))
                        obj.keys[newKey].from = rtx.output.user ? rtx.output.user + "@" + nidObj.domain : nidObj.domain
                }
                obj.dirty = true
            }
        }
        for (const key in rtx.output.value) {
            let newKey = key.toLowerCase()
            let newValue = rtx.output.value[key]
            CMD_KEY.updateKeyAndHistory(nidObj, newKey, newValue, rtx.output)
        }

        return nidObj
    }
}

module.exports = { Parser_Domain }