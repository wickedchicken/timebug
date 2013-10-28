function customInit(){
  window.init();
}

var myApp = angular.module('timetracker',[]);
 
myApp.controller('trackcontroller', function($scope, $timeout, $window, $location) {
  $scope.backend_ready = false
  $scope.buttontext = 'start'
  $scope.start = null;
  $scope.time = 0.0;
  $scope.elapsed = 0.0;
  $scope.actual_mins = 0.0;
  $scope.actual_secs = 0.0;
  $window.init = function() {
    gapi.client.load('tasktimer', 'v1', function() {
      $scope.backend_ready = true
    }, '/_ah/api');
  };
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
        $scope.time = 0.0;
        $scope.actual_mins = 0.0;
        $scope.actual_secs = 0.0;
        $scope.estimated = 0.0;
        $scope.name = '';
        $scope.apply()
      });
    }
  };
});
