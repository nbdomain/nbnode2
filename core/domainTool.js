const CONSTS = require('./const')
const { NBLib, Util } = require('./util')
var axios = require("axios");

class DomainTool {
    /**
   * Fetch NidOject from remote endpoint.
   * @param {!NidObject} domain 
   */
    static async fetchDomainPrice(domain, db, newTx = false) {
        try {
            await Util.initNBLib()
            const key = domain + ".prices"
            const obj = await db.loadDomain("nbinfo.b")
            if (obj && obj.keys[key]) {
                return { code: 0, price: r.obj.keys[key].value.price }
            }
            domain = encodeURIComponent(domain)
            let url = `${CONSTS.nidcheck_endpoint}${domain}?prereg=${newTx}`;
            console.log(`Sending request to URL ${url}`);
            let res = await axios.get(url, { timeout: 10000 });
            return res.data;
        } catch (error) {
            console.log(error);
            return { code: -1000, message: error };
        }
    }

}

// ------------------------------------------------------------------------------------------------

module.exports = {
    DomainTool
}