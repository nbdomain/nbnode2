const {Util} = require('./util')
const { CONFIG } = require('./config')
const { CMD,DEF } = require('./def')
const Parser = require('./parser')
var axios = require("axios");

class DomainTool {
    /**
   * Fetch NidOject from remote endpoint.
   * @param {!NidObject} domain 
   */
    static async fetchDomainAvailibility(domain) {
        try {
            let url = `${CONFIG.nidcheck_endpoint}${domain}`;
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