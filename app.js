const builder = require('botbuilder');
const express = require('express');
const request = require('request');
const querystring = require('querystring');

const app = express();

//=========================================================
// Setup
//=========================================================

const port = process.env.port || process.env.PORT || 3000;
const server = app.listen(port, () => {
    console.log('bot is listening on port %s', port);
});

// Create chat bot
const connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

const bot = new builder.UniversalBot(connector);

app.post('/api/messages', connector.listen());

var googleMapsClient = require('@google/maps').createClient({
    key: process.env.GOOGLE_MAP_KEY,
    Promise: Promise
});

const LuisEndpoint = 'https://westus.api.cognitive.microsoft.com/luis/v2.0/apps/955554a2-3512-4943-81b9-9cf2fc88919a?subscription-key=898f1043f83542a0ac3a5b8e5ecde6ad&verbose=true&timezoneOffset=0';

const firstChoices = {
    "家から会社まで": {
        value: 'wayToWorkFromHome'
    },
    "現在地から会社まで": {
        value: 'wayToWorkFromHere'
    },
    "家までの終電": {
        value: 'lastTrain'
    },
    "それ以外のルート検索": {
        value: 'others'
    },
};

const homeAddress = 'kawasaki';
const workAddress = 'tokyo';

//=========================================================
// Bots Dialogs
//=========================================================

// When user joins, it begin dialog
bot.on('conversationUpdate', message => {
    if (message.membersAdded) {
        message.membersAdded.forEach(identity => {
            if (identity.id === message.address.bot.id) {
                bot.beginDialog(message.address, '/');
            }
        });
    }
});

const callLUIS = (text) => {
    return new Promise((resolve, reject) => {
        var params = { q: text };

        request({ url: LuisEndpoint, qs: params }, function(err, response, body) {
            if (err) { console.log(err); return; }
            console.log(response.body);
            resolve(JSON.parse(response.body));
        });
    });
}

bot.dialog('/getLastTrain', [
    session => {
        session.send('自宅までの終電を検索しています。');
        showDirection(session, homeAddress, workAddress);
    }
]);

bot.dialog('/getWayToWorkFromHome', [
    session => {
        session.send('自宅から会社までのルートを検索します。');
        showDirection(session, homeAddress, workAddress);
    }
]);

const getDirection = (origin, destination, option) => {
    return new Promise((resolve, reject) => {
        googleMapsClient.directions({
                origin: origin,
                destination: destination,
                // mode: 'walking',
                mode: 'driving',
                transit_mode: 'subway',
                // arrival_time: '',
                // 'departure_time': ''
                language: 'ja',
            }).asPromise()
            .then((response) => {
                resolve(response)
            }).catch(error => {
                console.log(error)
            });
    })
}

const getStaticMapImageURL = (from, to, route) => {
    const polyline_data = route.overview_polyline.points;
    let imageURL = `https://maps.googleapis.com/maps/api/staticmap`;
    const imageURLParams = {
        // center: '東京',
        // zoom: 13,
        size: '400x400',
        markers: `${from}|${to}`,
        weight: 3,
        color: 'orange',
        path: `color:red|enc:${polyline_data}`,
        key: 'AIzaSyCUT6rrf8FkQp59wQ1IYNrCGhyb29nhZKY'
    };
    imageURL += '?' + querystring.stringify(imageURLParams);
    return imageURL
}

const getGoogleMapURL = (from, to) => {
    let url = 'https://www.google.com/maps/dir/';
    const urlParams = {
        api: 1,
        origin: from,
        destination: to,
        travelmode: 'transit',
        departure_time: 111111111
            // travelmode: 'transit'
    };
    url += '?' + querystring.stringify(urlParams);
    return url;
}

const showDirection = (session, from, to) => {
    getDirection(from, to).then((response) => {
        console.log(response.requestUrl)
        console.log('=====================================')
        if (response.json.routes.length > 0) {
            // console.dir(response.json);
            console.log('=====================================')
            const route = response.json.routes[0];
            console.log('route')
            console.log(route)
            console.log('=====================================')
            const imageURL = getStaticMapImageURL(from, to, route);
            const mapURL = getGoogleMapURL(from, to);
            console.log('map', mapURL)

            console.log('legs')
            console.log(route.legs[0])
            console.log('=====================================')

            // prepare card text
            let subtitle = '';
            let text = '';

            if (route.legs) {
                const leg = route.legs[0];
                if (leg.arrival_time && leg.departure_time) {
                    text += '出発: ' + leg.departure_time.text + " ~ 到着: " + leg.arrival_time.text;
                }
                const distance = leg.distance.text;
                const duration = leg.duration.text;
                subtitle = distance + " | " + duration;
            }

            if (route.fare) {
                subtitle += " | " + route.fare.text
            }


            // create card object
            const card = new builder.HeroCard(session)
                .title(`${from} 〜 ${to}`)
                .subtitle(subtitle)
                .text(text)
                .images([
                    builder.CardImage.create(session, imageURL)
                ])
                .buttons([
                    builder.CardAction.openUrl(session, mapURL, '地図を開く')
                ]);

            const cardMsg = new builder.Message(session).addAttachment(card);
            session.send(cardMsg);
        } else {
            session.send("申し訳ありません。ルートを探すことができませんでした。");
            session.beginDialog('/getText');
        }
    })
}

bot.dialog('/getSentence', [
    (session, results, next) => {
        builder.Prompts.text(session, "入力してね。");
    },
    (session, results, next) => {
        const text = results.response;
        callLUIS(text).then(res => {
            const intent = res.topScoringIntent.intent;

            let from = 'nowLocation';
            let to;
            let lastTrain = false;
            let firstTrain = false;

            res.entities.forEach(e => {
                if (e.type === 'to') {
                    to = e.entity;
                } else if (e.type === 'from') {
                    from = e.entity;
                } else if (e.type === 'lastTrain') {
                    lastTrain = true;
                }
            });

            if (intent == 'goToSomewhere' && !to) {
                throw new Error('no destination');
            } else if (intent === 'backToHome' && !to) {
                to = 'home';
            }

            let title = '';
            if (intent === 'goToSomewhere') {
                title = `${from}から${to}`;
            } else if (intent === 'backToHome') {
                if (lastTrain) {
                    title = `${from}からの終電`;
                }
                title = `${from}からの帰り道`;
            }

            session.send(title + 'ですね。');

            showDirection(session, from, to);
        })
    }
])

bot.dialog('/firstChoice', [
    (session, results, next) => {
        builder.Prompts.choice(session, "何をお探しですか。", firstChoices, { listStyle: 3 });
    },
    (session, results, next) => {
        const entity = results.response.entity;
        const val = firstChoices[entity].value;
        switch (val) {
            case 'lastTrain':
                session.beginDialog('/getLastTrain');
                break;
            case 'wayToWorkFromHome':
                session.beginDialog('/getWayToWorkFromHome');
                break;
            case 'wayToWork':
                session.beginDialog('/getWayToWorkFromHere');
                break;
            case 'others':
                session.beginDialog('/getSentence');
                break;
                // default:
                //     break;
        }
        console.log(results.response.entity)
    }
]);

bot.dialog('/endDialog', [
    session => {
        builder.Prompts.confirm(session, "疑問は解決しましたか？", { listStyle: 3 });
    },
    (session, results) => {
        console.log(results.response);
        if (results.response) {
            session.send('ありがとうございました。');
            session.endDialog();

        } else {
            session.send('お役に立てず申し訳ありません。');
            session.beginDialog('/getText');
        }
    }
]);

bot.dialog('/', [
    session => {
        session.send("ボットが自動でお答えします。");
        session.beginDialog('/firstChoice');
    }
]);