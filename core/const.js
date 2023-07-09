const TIMEOUT = 20000
const MEMPOOL_EXPIRATION = 60 * 60 * 24

require('axios').default.defaults.timeout = TIMEOUT

const CONSTS = {
    TXDB: 'txs.db',
    DMDB: 'domains.db',
    payment: {
        prices: {
            keyUpdate: { bsv: 2, ar: 10, contributeRate: 0.2 },
            sellFee: 0.1,
        },
        fundAddress: { bsv: "13NbzVaT9EYxRn1i16YCgHbmhvPWsQDhdh", ar: "DCpV0INlvFf3M7ypjjqdsIENHM9P6z08yJfFYqbPDkA" },
    },
    producers: [
        "036260ebdb52056455ad89c0733a52623f350c350b45f37ba974a44b1401ae553d",
        "0290086d885b6bbe7c88c5effde0b8cfafae5ee02104b6d1cef117c4804d997e8e",
        "02119cd2e3b480e0c95a330fa56ebea99191dca625387be880e0ade81b5c167b85",
        "02fc634b9a9d43141fb08d6d3365a1d4071ad7614b4076887eac092baf06b4698b"
    ],
    "modules": {
        "/api": "api",
        //'/web': "web",
        "/chain": "chain"
    },
    "admin": {
        "transfer_fee": 1000,
        "transfer_fee_rate": 0.1
    },
    "tld_config": {
        "test": {
            "testing": true,
            "price_url": "https://util.nbsite.link/namecheck/v1/check/",
            "chain": "bsv",
            "address": {
                "payment": "19fLpT5LpaMGKuLfUVqmNdXkVceq2rbjyn",
                "protocol": "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5",
                "admin": "1KEjuiwj5LrUPCswJZDxfkZC8iKF4tLf9H",
                "other_admins": [
                    {
                        "address": "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5",
                        "start_time": 0,
                        "end_time": 1603775745
                    },
                ]
            },
        },
        "b": {
            "chain": "bsv",
            "price_url": "https://util.nbsite.link/namecheck/v1/check/",
            "address": {
                "payment": "15Cww7izEdyr8QskJmqwC5ETqWREZCjwz4",
                "protocol": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
                "admin": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
                "other_admins": []
            },
        },
        "a": {
            "chain": "ar",
            "price_url": "https://util.nbsite.link/namecheck/v1/check/",
            "address": {
                "payment": "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ",
                "protocol": "ardomaina",
                "admin": "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ",
                "other_admins": []
            },
        },
    }
}
module.exports = CONSTS