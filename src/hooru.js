/**
hooru.js - Login and authentication (oauth) 
TODO json web tokens
TODO add associate -- or is that always server side?
TODO add browser tracking codes

Assumes:
	jquery, SJTest, cookie-js

	Depends on an external web-server (login.soda.sh). 
	Depends on HooruServlet.java
*/

/**
	@typedef {Object} User
	@property xid {!string}
	@property name {?string}
	@property service {!string}
	@property img {?string}
	@property externalUrl {?string}
 */

(function(window){
	"use strict";	

	// MUST have js-cookie and SHOULD have assert
	if (typeof(assert)==='undefined') {
		console.warn("Login: creating assert. Recommended: import SJTest");
		assert = function(betrue, msg) {
			if ( ! betrue) throw new Error("assert-failed: "+msg); 
		};
	}
	if (typeof(Cookies)==='undefined') {
		if (window.Cookies) {
			var Cookies	= window.Cookies;
		} else {
			// try a require (should work in node, and maybe in the browser if you have a require function defined)
			var Cookies = require('js-cookie');
		}
		// import Cookies from 'js-cookie'; Avoid ES6 for now
	}	
	assert(Cookies && Cookies.get, "Please install js-cookie! See https://www.npmjs.com/package/js-cookie");


	var Login = {
		/** This app, as known by Hooru. You MUST set this! */
		app: null,
		/** {User[]} An array of user-info objects. E.g. you might have a Twitter id and an email id.
		You could even have a couple of email ids. Always includes Login.user. */
		aliases: null,
		/** {User} The id they last logged in with. */
		user: null,
		/** {id, text} Error message, or null */
		error: null,
		/** with auth() by Twitter -- where to redirect to on success. Defaults to this page. */
		redirectOnLogin: window.location,
		/** The server url. Change this if you use a different login server. */
		ENDPOINT: 'https://hooru.soda.sh/hooru.json',

		PERMISSIONS: {
			/** Get an ID to identify who this is, but no more. */
			ID_ONLY:'ID_ONLY',
			READ:'READ',
			/** indicates "ask for all the permissions you can" */
			ALL:'ALL'
		}
	};

	// Export the Login module
	window.Login = Login;
	if (typeof module !== 'undefined') {
	  module.exports = window.Login;
	}	

	var callbacks = [];
	/**
	@param callback will be called with Login.user if the state changes.
	If callback is not given -- this simulates a change (a la jquery);
	*/
	Login.change = function(callback) {
		if (callback) {
			//assertMatch(callback, Function);
			callbacks.push(callback);
			return;
		}
		for(const cb of callbacks) {
			cb(Login.aliases);
		}
	};

	/**
	@param service {?string} Optional selector
	@return {string} The (first) xid for this service, or null.
	*/
	Login.getId = function(service) {
		var u = Login.getUser(service);
		if ( ! u) {
			return null;
		}
		return u.xid;
	};

	/**
	@return {string} A temporary unique id. This is persisted as a cookie.
	You can use this before the user has logged in.
	*/
	Login.getTempId = function() {
		var u = Login.getUser('temp');
		if (u) return u.xid;
		// make a temp id
		var tempuser = {
			name: 'Temporary ID',
			xid: guid()+'@temp',
			service: 'temp'
		};
		setUser(tempuser);
		// provide a webtoken too
		Cookies.set(COOKIE_WEBTOKEN+"."+tempuser.xid, tempuser.xid, {path: COOKIE_PATH});
		return tempuser.xid;
	};

	var guid = function() {
	    // A Type 4 RFC 4122 UUID, via http://stackoverflow.com/a/873856/346629
	    var s = [];
	    var hexDigits = "0123456789abcdef";
	    for (var i = 0; i < 36; i++) {
	        s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
	    }
	    s[14] = "4";  // bits 12-15 of the time_hi_and_version field to 0010
	    s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1);  // bits 6-7 of the clock_seq_hi_and_reserved to 01
	    s[8] = s[13] = s[18] = s[23] = "-";
	    var uuid = s.join("");
	    return uuid;
	};

	/**
	@param service {?string} Optional selector
	@return {User} The (first) user for this service, or null.
	*/
	Login.getUser = function(service) {
		if ( ! Login.user) return null;
		if ( ! service || Login.user.service === service) return Login.user;
		if ( ! Login.aliases) {
			return null;
		}
		for(var alias of Login.aliases) {
			assert(alias.xid, alias);
			if (getService(alias.xid) === service) {
				return alias;
			}			
		}
		// HACK an xid in the user?
		if (Login.user && Login.user.xids && Login.user.xids[service]) {
			return {
				xid: Login.user.xids[service],
				xids: Login.user.xids
				}; // not much we can say about them!
		} 
		return null;
	};

	// TODO move aliases and user to local-storage 'cos they're chunky json blobs
	var COOKIE_BASE = "hooru";
	var COOKIE_UXID = "uxid";
	var COOKIE_WEBTOKEN = COOKIE_BASE+".jwt";
	const COOKIE_PATH = '/';

	/** true if logged in, and not a temp-id */
	Login.isLoggedIn = function() { 
		return Login.user && Login.user.service !== 'temp'? true : false;
	}

	/** Is the user signed in? Check with the server.
	@return: promise */
	Login.verify = function() {
		console.log("start login...");
		var auth = aget(Login.ENDPOINT, {action:'verify'});
		return auth.then(function(res) {
			if ( ! res || ! res.success) {
				logout2();
			} else {
				setStateFromServerResponse(res);
			}
			return res;
		}).fail(function(res){
			console.warn("login.verify fail", res, res.status);
			if (res && res.status && res.status >= 400 && res.status < 500) {
				// 40X (bad inputs) logout
				logout2();				
			}
			// 50X? no-op
			return res;
		});
	};

	var setStateFromServerResponse = function(res) {
		console.log('setStateFromServerResponse', res);
		if (res.errors && res.errors.length) {
			// stash the error for showing to the user
			console.error("#login.state", res.errors[0]);
			Login.error = res.errors[0];
			console.log('Login.error set ',res.errors[0]);
			return res;
		}
		let newuser = res.cargo && res.cargo.user;
		// {User[]}
		let newaliases = res.cargo && res.cargo.aliases && res.cargo.aliases.slice();
		// check the cookies (which may have changed)
		let cuxid = Cookies.get(COOKIE_UXID);
		let cuserjson = cuxid? window.localStorage.getItem(cuxid) : null;
		// string[] XIds
		let cookieAliases = [];
		const cookies = Cookies.get();
		for(let c in cookies) {
			// workaround for server-side bug, where url-encoded name gets wrapped in quotes
			if (c.charAt(0) === '"') {
				c = c.slice(1, -1);
			}
			if (c.substr(0, COOKIE_WEBTOKEN.length)===COOKIE_WEBTOKEN) {
				// a token? add to aliases
				try {
					let cxid = c.substr(COOKIE_WEBTOKEN.length+1);
					assert(getService(cxid), cxid);
					cookieAliases.push(cxid);
				} catch(error) {
					// swallow the bad cookie
					console.error(error);
				}
			}
		}
		if (cuserjson) {
			try {
				var cuser = JSON.parse(cuserjson);
				if ( ! newuser) newuser = cuser;
			} catch(error) {
				console.error("login", error);
			}
		}
		console.log("login coookies", cookieAliases, cuser);
		if (cuxid && ! newuser) newuser = {xid:cuxid};
		if ( ! newaliases) newaliases = [];
		for(let cxid of cookieAliases) {
			assert(getService(cxid), cxid);	
			if (_.find(newaliases, {xid:cxid})) continue;
			newaliases.push({xid:cxid});					
		}
		if (newaliases.length && ! newuser) {
			newuser = newaliases[0];
		}
		if ( ! newuser) {
			logout2();
			return res;
		}
		// prefer a non-temp user
		if (getService(newuser.xid) === 'temp') {
			for(let i=0; i<newaliases.length; i++) {
				const alias = newaliases[i];
				if (getService(alias.xid)==='temp') continue;
				newuser = alias;
				break;
			}
		}
		setUser(newuser, newaliases);
		// clear the error
		Login.error = null;
		return res;
	};

	var getService = function(xid) {
		assert(typeof(xid)==='string',xid);
		var i = xid.lastIndexOf('@');
		assert(i!=-1, "CreoleBase.js - service:Not a valid XId No @ in "+xid);
		return xid.substring(i+1);
	};


	/**
	 * @param {User} newuser
	 * @param {?User[]} newaliases 
	 */
	var setUser = function(newuser, newaliases) {
		console.log("setUser", newuser, newaliases);
		var oldxid = Login.user && Login.user.xid;
		if (Login.user && Login.user.xid === newuser.xid) {
			// keep old info... but newuser overrides
			newuser = $.extend({}, Login.user, newuser);
			// TODO extend aliases
		}
		// set user
		Login.user = newuser;
		// service
		if ( ! Login.user.service) {
			Login.user.service = getService(Login.user.xid);
		}
		// set aliases
		if (newaliases && newaliases.length !== 0) {
			Login.aliases = newaliases;
			assert(newaliases[0].xid, newaliases);
		} else if (newuser.xid === oldxid) {
			// leave as is
		} else {
			// aliases = just the user
			Login.aliases = [newuser];
		}
		Cookies.set(COOKIE_UXID, Login.user.xid, {path: COOKIE_PATH});
		// webtoken: set by the server
		window.localStorage.setItem(Login.user.xid, JSON.stringify(Login.user));
		if (oldxid != newuser.xid) {
			Login.change();
		}
	};

	Login.loginForm = function(el) {
		var $form = $(el).closest('form');
		var peep = $form.find('input[name=person]').val();
		var password = $form.find('input[name=password]').val();
		console.warn("#login peep", peep, password);
		return Login.login(peep, password);
	}

	Login.login = function(person, password) {
		if ( ! password) {
			console.log("#login: no password for "+person);
			Login.error = {id:'missing-password', text:'Missing input: Password'};
			return Promise.resolve(null); // fail
		}
		// clear any cookies
		logout2();
		// now try to login
		var auth = aget(Login.ENDPOINT, {action:'login', person:person, password:password});
		auth = auth.then(setStateFromServerResponse);
		return auth;
	};

	/**
	 * Authorise via Twitter etc. This will redirect the user away!
	@param service {string} e.g. twitter
	@param app {string} Your app-id for the service
	@param permissions {string?} what permissions do you need?
	*/
	Login.auth = function(service, app, permissions) {
		window.location = Login.ENDPOINT+"?action=get-auth&app="+escape(app)
			+"&service="+service+"&permissions="+escape(permissions)
			+"&link="+(Login.redirectOnLogin || '');
	};

	/**
	* Register a new user, typically with email & password
	@param registerInfo {email:string, password:string}
	*/
	Login.register = function(registerInfo) {
		registerInfo.action = 'signup';
		var request = aget(Login.ENDPOINT, registerInfo);
		request = request.then(setStateFromServerResponse);
		return request;
	};


	/**
	 * TODO Password reset by email
	 */
	Login.reset = function(email, brandingParams) {
		assert(email);
		const params = brandingParams || {};
		params.email = email; params.action='reset';
		var request = aget(Login.ENDPOINT, params);
		request = request.then(setStateFromServerResponse);
		return request;
	};


	Login.logout = function() {
		console.log("logout");
		var serverResponse = aget(Login.ENDPOINT, {action:'logout'});
		logout2();
		return serverResponse;
	};

	/** convenience for ajax with cookies */
	var aget = function(url, data) {
		assert(Login.app, "You must set Login.app = my-app-name-as-registered-with-Hooru");
		data.app = Login.app;
		return $.ajax({
			url: url,
			data: data,
			type:'GET',
			xhrFields: {withCredentials: true}
		});
	};

	var logout2 = function() {
		console.log('logout2 - clear stuff');
		const cookies = Cookies.get();
		for(let c in cookies) {
			if (c.substr(0, COOKIE_BASE.length)===COOKIE_BASE) {
				console.warn("remove cookie "+c);
				Cookies.remove(c, {path: COOKIE_PATH});
			}
		}
		Cookies.remove(COOKIE_UXID, {path: COOKIE_PATH});
		Login.user = null;
		Login.aliases = null;
		Login.error = null;
		Login.change();
	};

	Login.logoutAndReload = function() {
		Login.logout();
		window.location.reload();
	};


	/** TODO merge / equiv / associate /alias: these links are directed, via share.
	 * 
	 * Share puppetXId with ownerXId (i.e. ownerXId will have full access to puppetXId).
	 * 
	 * Security: The browser must have tokens for both XIds for this request to succeed. 
	 * So the user must have auth'd as both.
	 * 
	 * This should add puppetXId to the XIds of ownerXId.
	 * @param bothWays {?boolean} If true, this relation is bi-directional: */
	Login.share = function(puppetXId, ownerXId, bothWays) {
		var request = aget(Login.ENDPOINT, {
			'action':'share',
			'entity': puppetXId,
			'shareWith': ownerXId,
			'bothWays': bothWays
		});
		request = request.then(setStateFromServerResponse);
		return request;
	};

	/**
	 * Share something related to your app with another user.
	 * The share comes from the current user.
	 * @param thingId {String} ID for the thing you want to share. 
	 * This ID is app specific.
	 */
	Login.shareUrl = function(thingId, personXId) {
		var request = aget(Login.ENDPOINT, {
			'action':'share',
			'entity': thingId,
			'as': Login.getId(),
			'shareWith': personXId
		});
		return request;
	}

	// Initialise from cookies
	setStateFromServerResponse({});

}(window));
