const CONSTS = {
    node_info: {
        prices: {
            domainHost: { bsv: 1000, ar: 1000 }, //host user's triditional domain and link to a nbdomain
            keyUpdate: { bsv: 1.0, ar: 1.0 }
        },
    },
    "nidcheck_endpoint": "https://util.nbsite.link/namecheck/v1/check/",
    "admin": {
        "transfer_fee": 1000,
        "transfer_fee_rate": 0.1
    },
    "tld_config": {
        "test": {
            "testing": true,
            "chain": "bsv",
            "address": {
                "payment": "19fLpT5LpaMGKuLfUVqmNdXkVceq2rbjyn",
                "protocol": "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5",
                "admin": "1KEjuiwj5LrUPCswJZDxfkZC8iKF4tLf9H",
                "other_admins": [
                    {
                        "address": "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5",
                        "start_block": 0,
                        "end_block": 658652
                    },
                ]
            },
        },
        "b": {
            "chain": "bsv",
            "address": {
                "payment": "15Cww7izEdyr8QskJmqwC5ETqWREZCjwz4",
                "protocol": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
                "admin": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
                "other_admins": []
            },
        },
        "a": {
            "chain": "ar",
            "address": {
                "payment": "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ",
                "protocol": "ardomaina",
                "admin": "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ",
                "other_admins": []
            },
        }
    }
}
module.exports = CONSTS