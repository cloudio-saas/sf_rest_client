// 3rd party dependencies
const path = require('path'),
    express = require('express'),
    session = require('express-session'),
    jsforce = require('jsforce');

// Load and check config
require('dotenv').config();
if (!(process.env.loginUrl && process.env.consumerKey && process.env.consumerSecret && process.env.callbackUrl && process.env.apiVersion && process.env.sessionSecretKey)) {
    console.error('Cannot start app: missing mandatory configuration. Check your .env file.');
    process.exit(-1);
}

// Instantiate Salesforce client with .env configuration
const oauth2 = new jsforce.OAuth2({
    loginUrl: process.env.loginUrl,
    clientId: process.env.consumerKey,
    clientSecret: process.env.consumerSecret,
    redirectUri: process.env.callbackUrl
});


// Setup HTTP server
const app = express();
const port = process.env.PORT || 8080;
app.set('port', port);

// Enable server-side sessions
app.use(
    session({
        secret: process.env.sessionSecretKey,
        cookie: { secure: process.env.isHttps === 'true' },
        resave: false,
        saveUninitialized: false
    })
);

// Serve HTML pages under root directory
app.use('/', express.static(path.join(__dirname, '../public')));

/**
 *  Attemps to retrieves the server session.
 *  If there is no session, redirects with HTTP 401 and an error message
 */
function getSession(request, response) {
    const session = request.session;
    if (!session.sfdcAuth) {
        response.status(401).send('No active session');
        return null;
    }
    return session;
}

function resumeSalesforceConnection(session) {
    return new jsforce.Connection({
        instanceUrl: session.sfdcAuth.instanceUrl,
        accessToken: session.sfdcAuth.accessToken,
        version: process.env.apiVersion
    });
}

/**
 * Login endpoint
 */
app.get('/auth/login', (request, response) => {
    // Redirect to Salesforce login/authorization page
    response.redirect(oauth2.getAuthorizationUrl({ scope: 'api' }));
});


/**
 * Logout endpoint
 */
app.get('/auth/logout', (request, response) => {
    const session = getSession(request, response);
    if (session == null) return;

    // Revoke OAuth token
    const conn = resumeSalesforceConnection(session);
    conn.logout((error) => {
        if (error) {
            console.error('Salesforce OAuth revoke error: ' + JSON.stringify(error));
            response.status(500).json(error);
            return;
        }

        // Destroy server-side session
        session.destroy((error) => {
            if (error) {
                console.error('Salesforce session destruction error: ' + JSON.stringify(error));
            }
        });

        // Redirect to app main page
        return response.redirect('/index.html');
    });
});

/**
 * Endpoint for retrieving currently connected user
 * 3MVG9fMtCkV6eLheC2CXOuLSJtisvOCJ44yP_VYzCCPzreZ5dZiO_9DSbmpfAFPkR9JAiba_kNOME1KXiVvWg
 * CDFAA3B3881BC0EFA5FBBE879352E013C8D0C4CA9308523BD6F8DA493D5A3FFA

 */
app.get('/auth/whoami', (request, response) => {
    const jsfconn = new jsforce.Connection({
        oauth2: oauth2,
        version: process.env.apiVersion
    });
    jsfconn.loginByOAuth2(process.env.username, process.env.password, function(error, userInfo) {
        if (error) {
            console.log('Salesforce authorization error: ' + JSON.stringify(error));
            response.status(500).json(error);
            return;
        }
        request.session.sfdcAuth = {
            instanceUrl: jsfconn.instanceUrl,
            accessToken: jsfconn.accessToken
        };
        const session = getSession(request, response);
        if (session == null) {
            return;
        }

        // Request session info from Salesforce
        const conn = resumeSalesforceConnection(session);
        conn.identity((error, res) => {
            response.send(res);
        });
    });
});

/**
 * Endpoint for performing a SOQL query on Salesforce
 */
app.get('/query', (request, response) => {
    const session = getSession(request, response);
    if (session == null) {
        return;
    }

    const query = request.query.q;
    if (!query) {
        response.status(400).send('Missing query parameter.');
        return;
    }

    const conn = resumeSalesforceConnection(session);
    conn.query(query, (error, result) => {
        if (error) {
            console.error('Salesforce data API error: ' + JSON.stringify(error));
            response.status(500).json(error);
            return;
        } else {
            response.send(result);
            return;
        }
    });
});

app.listen(app.get('port'), () => {
    console.log('Server started: http://localhost:' + app.get('port') + '/');
});