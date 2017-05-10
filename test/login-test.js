describe('Login', function() {
	Login.app = 'test';
	const TEST_EMAIL = 'test@example.com';
	Login.ENDPOINT = 'http://localhost:8118/hooru.json';

	describe('isLoggedIn', function() {
		it('should return false when not logged in', function() {
			Login.logout();
			assert( ! Login.isLoggedIn());
		});
		it('should return true when logged in', function() {
			Login.user = {name:'Test User'};
			assert(Login.isLoggedIn());
		});
	});

	describe('#getId()', function() {
		it('should return falsy when not logged in', function() {
			Login.logout();
			assert( ! Login.getId());
		});
		it('should return an xid when logged in', function() {
			Login.user = {name:'Test User',xid:'test-id'};
			console.log("getId", Login.getId());
			assert(Login.getId());
		});
	});


	describe('#reset()', function() {
		it('should pass a smoketest', function(done) {
			const preset = Login.reset(TEST_EMAIL);
			preset.then(function(r) {
				console.log("reset", r);
				done();
			});
		});
	});

	describe('verify', function() {
		it('should return a promise', function() {
			var lp = Login.verify();
			assert(lp.then);
		});
		it('should be null after logout', function(done) {
			Login.logout();
			var lp = Login.verify();
			lp.always(function(a) {
				assert( ! Login.isLoggedIn());
				done();
			});
		});
	});

	describe('register', function() {
		it('should work for '+TEST_EMAIL, function(done) {
			Login.logout().then(function() {
				var lp = Login.register({email:TEST_EMAIL, password:'1234'});
				lp.then(function() {
					assert(Login.user && Login.user.xid, Login);
					assert(Login.getUser().xid.indexOf(TEST_EMAIL) === 0);
					done();
				});
			});
		});
	});

	describe('login', function() {
		it('should work with name/password', function(done) {
			Login.logout().then(function() {
				var lp = Login.login(TEST_EMAIL,'1234');
				lp.then(function() {
					assert(Login.user && Login.user.xid, Login);
					assert(Login.getUser().xid.indexOf(TEST_EMAIL) === 0);
					done();
				});
			});
		});
	});

	describe('login', function() {
		it('should not work with the wrong password', function(done) {
			Login.logout().then(function() {
				var lp = Login.login(TEST_EMAIL,'no-no');
				lp.always(function() {
					assert( ! Login.isLoggedIn());
					assert( ! Login.user);
					done();
				});
			});
		});
	});


	describe('share', function() {
		it('should let us link to an email', function(done) {
			Login.login(TEST_EMAIL,'1234')
			.then(function() {
				Login.shareLogin(Login.getId, "test2@example.com@email")
				.then(function() {
					done();
				})				
			});
		});
	});


	describe('#getTempId()', function() {
		it('should provide an id even when logged out', function(done) {
			if ( ! Login.isLoggedIn()) {
				var id = Login.getTempId();
				assert(id, Login);
				var id2 = Login.getId();
				assert(id == id2, id2);
				assert(id == Login.getUser().xid, Login.user);
				done();
				return;
			}
			Login.logout().then(function() {
				var id = Login.getTempId();
				assert(id, Login);
				var id2 = Login.getId();
				assert(id == id2, id2);
				assert(id == Login.getUser().xid, Login.user);
				done();
			});
		});
	});

});
