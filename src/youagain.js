/**
youagain.js - Login and authentication (oauth) 
TODO json web tokens
TODO add associate -- or is that always server side?
TODO add browser tracking codes

Assumes:
	jquery, SJTest, cookie-js

	Depends on an external web-server (login.soda.sh). 
	Depends on you-againServlet.java
*/

/**
	@typedef {Object} User
	@property xid {!string}
	@property name {?string}
	@property service {!string}
	@property img {?string}
	@property externalUrl {?string}
 */

// convert to npm style?? But its nice that this will work as is in any app.
// import {$} from jquery;
// import {assert} from SJTest;

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
		/** This app, as known by you-again. You MUST set this! */
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
		ENDPOINT: 'https://youagain.winterwell.com/youagain.json',

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
	@return {string} The (first) xid for this service, or null. E.g. "moses@twitter"
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

	/**
	 * An email address for the current user.
	 * This is NOT necc a verified email - use it at your own risk.
	 * For a more cautious approach, use `Login.getUser('email')`
	 */
	Login.getEmail = function() {		
		let emailXId = Login.getId('email');
		if (emailXId) {
			let i = emailXId.lastIndexOf('@');
			return emailXId.substr(0, i);
		}
		// stab in the dark -- does the user have an email property?
		// This also provides a handy place where email can be stored on non-email (inc temp) users.
		let user = Login.getUser();
		let e = user && user.email;
		return e;
	};

	// TODO move aliases and user to local-storage 'cos they're chunky json blobs
	var COOKIE_BASE = "you-again";
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
			var skip;
			newaliases.forEach(na => {if (na.xid === cxid) skip = true;} );
			if (skip) continue;
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
	 * This is normally for internal use. It calls Login.change()
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
	}; // ./setUser
	// expose this for advanced external use!
	Login.setUser = setUser;

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
		auth = auth.then(setStateFromServerResponse)
				.fail(function(res) {
					Login.error = {id: res.statusCode, text: res.statusText};	
				});
		return auth;
	};

	/**
	 * Authorise via Twitter etc. This will redirect the user away!
	@param service {string} e.g. twitter
	@param appId {string} Your app-id for the service, e.g. '1847521215521290' for Facebook
	@param permissions {string?} what permissions do you need? See Login.PERMISSIONS
	@returns Nothing! TODO a future would be nice
	*/
	Login.auth = function(service, appId, permissions) {
		// Facebook via their API?
		if (service==='facebook') {
			assert(appId, "Please provide a FB app id");
			if (window.FB) {
				return doFBLogin();
			}
			window.fbAsyncInit = function() {
				FB.init({
					appId            : appId,
					autoLogAppEvents : false,
					xfbml            : false,
					version          : 'v2.9',
					status           : true // auto-check login
				});
				// FB.AppEvents.logPageView();
				FB.getLoginStatus(function(response) {
					console.warn("FB.getLoginStatus", response);
					if (response.status === 'connected') {
						doFBLogin_connected(response);
					} else {
						doFBLogin();
					}
				}); // ./login status
			};
			(function(d, s, id){
				let fjs = d.getElementsByTagName(s)[0];
				if (d.getElementById(id)) return;
				let js = d.createElement(s); js.id = id;
				js.src = "//connect.facebook.net/en_US/sdk.js";
				fjs.parentNode.insertBefore(js, fjs);
			}(document, 'script', 'facebook-jssdk'));
			return;
		} // ./fb

		// via the you-again server
		window.location = Login.ENDPOINT+"?action=get-auth&app="+escape(Login.app)
			+"&appId="+escape(appId)+"&service="+service
			+(permissions? "&permissions="+escape(permissions) : '')
			+"&link="+(Login.redirectOnLogin || '');
	};

	// Annoyingly -- this is likely to fail the first time round! They use a popup which gets blocked :(
	// Possible fixes: Load FB on page load (but then FB track everyone)
	// Use a redirect (i.e. server side login)
	const doFBLogin = function() {	
		console.warn("FB.login...");
		FB.login(function(response) {
			console.warn("FB.login", response);
			if (response.status === 'connected') {
				doFBLogin_connected(response);
			} else {
				// fail
			}
		}); //, {scope: 'public_profile,email,user_friends'}); // what permissions??
		// see https://developers.facebook.com/docs/facebook-login/permissions
	};

	const doFBLogin_connected = (response) => {
		let ar = response.authResponse;
		// ar.userID;
		// ar.accessToken;
		// ar.expiresIn;	
		Login.setUser({
			xid: ar.userID+'@facebook'
		});
		// TODO translate our permissions types into fields
		// ask for extra data (what you get depends on the permissions, but the ask is harmless)
		FB.api('/me?fields=name,about,cover,age_range,birthday,email,gender,relationship_status,website', function(meResponse) {
			console.warn('Successful login for: ' + meResponse.name, meResponse);
			Login.setUser({
				xid: ar.userID+'@facebook',
				name: meResponse.name
			});
			// trigger an update, even though the xid has stayed the same
			Login.change();
			// tell the backend
			let updateInfo = {
				action: "update",
				token: ar.accessToken,
				authResponse: JSON.stringify(ar),
				user: JSON.stringify(Login.getUser()),
				xid: Login.getId()
			};
			aget(Login.ENDPOINT, updateInfo)
			.then(	// JWT from YA has to be stored
				setStateFromServerResponse
			);
		});
	}; // ./doFBLogin_connected()

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
	 * Password reset by email
	 */
	Login.reset = function(email) {
		assert(email);
		const params = {
			email: email,
			action: 'reset'
		}
		var request = aget(Login.ENDPOINT, params)
			.then(function(res) {
				if (res.errors && res.errors.length) {
					// stash the error for showing to the user
					console.error("#login.state", res.errors[0]);
					Login.error = res.errors[0];
					return res;
				}
				return res;
			});
		return request;
	};

	/**
	 * Change password.
	 * 
	 * Note: This is a "higher security" action, and auth tokens aren't considered enough for this.
	 */
	Login.setPassword = function(email, currentPassword, newPassword) {
		assert(email && currentPassword && newPassword);
		const params = {
			email: email,
			action: 'set-password',
			auth: currentPassword,
			newPassword: newPassword
		}
		var request = aget(Login.ENDPOINT, params);
		return request;
	};



	Login.logout = function() {
		console.log("logout");
		var serverResponse = aget(Login.ENDPOINT, {action:'logout'});
		logout2();
		return serverResponse;
	};

	/** convenience for ajax with cookies */
	var aget = function(url, data, type) {
		assert(Login.app, "You must set Login.app = my-app-name-as-registered-with-you-again");
		data.app = Login.app;
		data.withCredentials = true; // let the server know this is a with-credentials call
		data.caller = ""+document.location; // provide some extra info
		return $.ajax({
			url: url,
			data: data,
			type: type || 'GET',
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

	/**
	 * "sign" a packet by adding jwt token(s)
	 * @param {Object|FormData} ajaxParams. A params object, intended for jQuery $.ajax.
	 * @returns the input object
	 */
	Login.sign = function(ajaxParams) {		
		assert(ajaxParams && ajaxParams.data, 'youagain.js - sign: no ajaxParams.data', ajaxParams);
		if ( ! Login.isLoggedIn()) return ajaxParams;
		dataPut(ajaxParams.data, 'app', Login.app);
		dataPut(ajaxParams.data, 'as', Login.getId());
		dataPut(ajaxParams.data, 'jwt', Login.getUser().jwt);
		ajaxParams.xhrFields = {withCredentials: true}; // send cookies
		dataPut(ajaxParams.data, 'withCredentials', true); // let the server know this is a with-credentials call
		return ajaxParams;
	};

	/**
	 * Utility to set a key=value pair for FormData (a browser native object) or a normal data map.
	 * @param {FormData|Object} formData 
	 * @param {String} key 
	 * @param {*} value 
	 */
	const dataPut = function(formData, key, value) {
		// HACK: is it a FormData object? then use append
		if (typeof(formData.append)==='function') {
			formData.append(key, value);
		} else {
			formData[key] = value;
		}
	};

	/** 
	 * Share puppetXId with ownerXId (i.e. ownerXId will have full access to puppetXId).
	 * 
	 * Security: The browser must have a token for puppetXId for this request to succeed. 
	 * 
	 * @param puppetXId {String} Normally Login.getId()
	 * @param bothWays {?boolean} If true, this relation is bi-directional: you claim the two ids are the same person. */
	Login.shareLogin = function(puppetXId, personXId, bothWays) {
		assert(isString(puppetXId), 'youagain.js shareThing() - Not a String ', puppetXId);
		assert(isString(personXId), 'youagain.js shareThing() - Not an XId String ', personXId);
		var request = aget(Login.ENDPOINT, {
			'action':'share',
			'entity': puppetXId,
			'shareWith': personXId,
			'equiv': bothWays
		});
		request = request.then(setStateFromServerResponse);
		return request;
	};

	/**
	 * delete a share
	 */
	Login.deleteShare = function(thingId, personXId) {
		assert(thingId && personXId, "youagain.js - deleteShare needs more info "+thingId+" "+personXId);
		var request = aget(Login.ENDPOINT, {
			'action':'delete-share',
			'entity': thingId,
			'shareWith': personXId
		}, 'DELETE');
		request = request.then(setStateFromServerResponse);
		return request;
	};

	/**
	 * Share something related to your app with another user.
	 * The share comes from the current user.
	 * @param thingId {String} ID for the thing you want to share. 
	 * This ID is app specific. E.g. "/myfolder/mything"
	 */
	Login.shareThing = function(thingId, personXId) {
		// actually they are the same call, but bothWays only applies for shareLogin
		return Login.shareLogin(thingId, personXId);
	}

	/**
	 * Claim ownership of a thing, which allows you to share it. 
	 * First-come first-served: If it has already been claimed by someone else then this will fail.
	 * @param thingId {String} ID for the thing you want to share. 
	 * This ID is app specific (i.e. app1 and app2 use different namespaces). E.g. "/myfolder/mything"
	 */
	Login.claim = function(thingId) {
		assert(isString(thingId), 'youagain.js claim() - Not a String ',thingId);
		var request = aget(Login.ENDPOINT, {
			action: 'claim',
			entity: thingId
		});
		return request;
	};

	/**
	 * List things shared with user.
	 * You are advised to cache this!
	 */
	Login.getSharedWith = function() {
		var request = aget(Login.ENDPOINT, {
			action:'shared-with'
		});
		return request;
	}	


	/**
	 * List things shared by the user.
	 * You are advised to cache this!
	 */
	Login.getSharedBy = function() {
		var request = aget(Login.ENDPOINT, {
			action:'shared-by'
		});
		return request;
	}

	const isString = x => typeof(x)==='string';

	/**
	 * Check whether the user can access this thing. 
	 * Returns a share object if there is one, otherwise returns without error but with success:false 
	 * You are advised to cache this!
	 */
	Login.checkShare = function(thingId) {
		assert(isString(thingId), 'youagain.js checkShare() - Not a String ',thingId);
		var request = aget(Login.ENDPOINT, {
			action: 'check-share',
			entity: thingId
		});
		return request;
	}


	/**
	 * List the shares for an object (the user must have access to the thing).
	 * You are advised to cache this!
	 */
	Login.getShareList = function(thingId) {
		assert(isString(thingId), 'youagain.js getShareList() - Not a String ',thingId);
		var request = aget(Login.ENDPOINT, {
			action: 'share-list',
			entity: thingId
		});
		return request;
	}

	// Initialise from cookies
	setStateFromServerResponse({});

}(typeof(window)==='undefined'? global : window));
