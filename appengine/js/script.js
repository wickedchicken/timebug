function customInit(){
  window.init();
}

var myApp = angular.module('timetracker',[]);
 
myApp.controller('trackcontroller', function($scope, $timeout, $window, $location, $http) {
  $scope.username = 'unauthorized';
  $scope.backend_ready = false;
  $scope.is_authorized = false;
  $scope.buttontext = 'start';
  $scope.start = null;
  $scope.time = 0.0;
  $scope.elapsed = 0.0;
  $scope.actual_mins = 0.0;
  $scope.actual_secs = 0.0;
  $window.init = function() {
    $scope.handleClientLoad();
  };

  $scope.clientId = '471586205082.apps.googleusercontent.com';
  $scope.apiscopes = ['https://www.googleapis.com/auth/userinfo.email'];
  $scope.handleClientLoad = function() {
    gapi.client.load('oauth2', 'v2', function() {
      $scope.$apply($scope.on_api_load)
    });
    gapi.client.load('tasktimer', 'v1', function() {
      $scope.$apply($scope.on_api_load)
    }, '/_ah/api');
  }

  $scope.checkAuth = function() {
    gapi.auth.authorize({client_id: $scope.clientId, scope: $scope.apiscopes,
      immediate: true}, $scope.handleAuthResult($scope.do_auth));
  }

  $scope.apis_to_load = 2;
  $scope.on_api_load = function(){
    --$scope.apis_to_load;
    if ($scope.apis_to_load == 0) {
      $scope.checkAuth();
    }
  }

  $scope.do_auth = function(){
    $scope.backend_ready = true;
    var request = gapi.client.oauth2.userinfo.get();
    request.execute($scope.getEmailCallback);
  }

  $scope.handleAuthResult = function(callback){
    return function(authResult) {
      if (authResult && !authResult.error) {
        console.log('authed!');
        callback();
      } else {
        $scope.$apply(function(){
          $scope.is_authorized = false;
        })
      }
    }
  }

  $scope.handleAuthClick = function(event) {
    gapi.auth.authorize({client_id: $scope.clientId, scope: $scope.apiscopes,
      immediate: false}, $scope.handleAuthResult($scope.do_auth));
  }

  $scope.logout = function(event) {
    var logout_url = 'https://accounts.google.com/o/oauth2/revoke?token=' + gapi.auth.getToken().access_token;
    $http.jsonp(logout_url).
      success(function(data, status, headers, config) {
        gapi.auth.setToken(null);
        $scope.is_authorized = false;
        $scope.username = false;
      }).
      error(function(data, status, headers, config) {
        // Google returns HTML instead of json, which is technically an error.
        gapi.auth.setToken(null);
        $scope.is_authorized = false;
        $scope.username = false;
      });
  }

  $scope.getEmailCallback = function(obj){
    $scope.$apply(function(){
      $scope.username = obj['email'];
      $scope.is_authorized = true;
      gapi.client.tasktimer.users.updateUser({
        'last_seen_email':obj['email']
      }).execute(function(resp) { console.log(resp);});
    })

    console.log(obj);   // Uncomment to inspect the full object.
  }


  $scope.onTimeout = function(){
    var newtime = new Date().getTime();
    $scope.elapsed = Math.floor(newtime - $scope.start) + $scope.time;

    var secs_elapsed = $scope.elapsed / 1000;
    $scope.actual_mins = secs_elapsed / 60;
    $scope.actual_secs = secs_elapsed % 60;

    $scope.mytimeout = $timeout($scope.onTimeout, 500);
  }

  $scope.timer_running = false
  $scope.toggleTimer = function(){
    if($scope.timer_running){
      $scope.time += new Date().getTime() - $scope.start;
      $scope.start = null;
      $scope.timer_running = false;
      $scope.buttontext = 'start'
      $timeout.cancel($scope.mytimeout);
    } else {
      $scope.start = new Date().getTime(),
      $scope.timer_running = true;
      $scope.buttontext = 'pause';
      $scope.mytimeout = $timeout($scope.onTimeout,500);
    }
  };
  $scope.submit = function(){
    if($scope.timer_running){
      $scope.toggleTimer()
    }
    if($scope.time > 0.0){
      gapi.client.tasktimer.tasks.createTask(
          {'name':$scope.name,
           'estimate':$scope.estimate * 60,
           'actual':$scope.time/1000,
           'finished':true
          }).execute(function(resp) {
        console.log(resp);
        $scope.$apply(function(){
          $scope.time = 0.0;
          $scope.actual_mins = 0.0;
          $scope.actual_secs = 0.0;
          $scope.estimated = 0.0;
          $scope.name = '';
        });
      });
    }
  };
});
