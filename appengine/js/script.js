function customInit(){
  window.init();
}

var myApp = angular.module('timetracker',[]);
 
myApp.controller('trackcontroller', function($scope, $timeout, $window, $location, $http) {
  $scope.estimate = 10.0
  $scope.username = 'unauthorized';
  $scope.backend_ready = false;
  $scope.is_authorized = false;
  $scope.buttontext = 'start';
  $scope.start = null;
  $scope.time = 0.0;
  $scope.elapsed = 0.0;
  $scope.actual_mins = 0.0;
  $scope.actual_secs = 0.0;
  $scope.tasks = [];
  $scope.posted_tasks = {};
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
    $scope.load_chart_api();
  }

  $scope.checkAuth = function() {
    gapi.auth.authorize({client_id: $scope.clientId, scope: $scope.apiscopes,
      immediate: true}, $scope.handleAuthResult($scope.do_auth));
  }

  $scope.apis_to_load = 3;
  $scope.on_api_load = function(){
    --$scope.apis_to_load;
    if ($scope.apis_to_load == 0) {
      $scope.checkAuth();
    }
  }

  $scope.concattasks = function () {
    return $scope.tasks.concat(_.values($scope.posted_tasks));
  }

  $scope.drawChart = function(){
    var header = [['Estimate', 'Actual']];

    var dat_norm = _.map($scope.concattasks(),
                    function(x){return [x.estimate / 60.0, (x.actual - x.estimate) / 60.0]});

    var default_append = function(obj, key, value){
      if (key in obj){
        obj[key].push(value);
      } else {
        obj[key] = [value];
      }
      return obj;
    };

    var grouped = _.reduce(dat_norm, function(x, y) {return default_append(x, y[0], y[1])}, {});

    var recursive_split = function(amount, low, high){
      var diff = high - low;
      var neg = low + Math.floor(diff / 2);
      var pos = low + Math.floor(diff / 2) + (diff % 2);
      if (amount > 0) {
        return recursive_split(amount - 1, low, neg).concat(
            recursive_split(0, neg, pos)).concat(
            recursive_split(amount -1, pos, high));
      } else {
        return [[neg, pos]];
      }
    };

    var stats = function(arr){
      if (arr.length < 1){
        return [];
      }

      var avg = _.reduce(arr, function(x, y) { return x + y }, 0.0) / arr.length;
      var max = _.max(arr);
      var min = _.min(arr);
      var sorted = _.sortBy(arr, function(a,b){return a-b});
      // recursive_split(1, ...) gives us quartiles.
      var quartiles = _.map(
          recursive_split(1, 0, arr.length - 1),
          function(x) {
            return (sorted[x[0]] + sorted[x[1]]) / 2.0;
          });

      // Regardless of how many divisions we specify in quartiles, make sure
      // upper/lower 25% are first and last. This way visualization will put a
      // line through them signifying middle 50%.
      var quartiles_idx = recursive_split(1, 0, quartiles.length - 1);
      var quartile_location = [_.first(_.first(quartiles_idx)),
                               _.last(_.last(quartiles_idx))];
      var low50 = quartiles.splice(quartile_location[0], 1)[0];
      var top50 = quartiles.splice(quartile_location[1] - 1, 1)[0];

      return [avg, low50, min, max].concat(quartiles).concat([top50]);
    }

    var group_stats = _.map(grouped, function(x, key) {
      return [Number(key)].concat(stats(x));
    });

    var snap_to = 5;
    if (group_stats.length > 0) {
      var max_estimate = _.max(_.map(_.keys(grouped), Number));
    } else {
      var max_estimate = 0;
    }

    var max_chart_value = max_estimate + (5 - (max_estimate % 5));

    var data = new google.visualization.DataTable();
    data.addColumn('number', 'estimate');
    data.addColumn('number', 'difference');
    data.addColumn({id:'i0', type:'number', role:'interval'});
    data.addColumn({id:'i1', type:'number', role:'interval'});
    data.addColumn({id:'i2', type:'number', role:'interval'});
    data.addColumn({id:'i3', type:'number', role:'interval'});
    data.addColumn({id:'i0', type:'number', role:'interval'});

    data.addRows(group_stats);

    // The intervals data as narrow lines (useful for showing raw source
    // data)
    var options = {
        title: 'Prediction Over/under estimate',
        curveType: 'function',
        series: [{'color': '#D9544C'}],
        intervals: { style: 'bars' },
        legend: 'none',
        width: 400,
        height: 300,
        hAxis: {baseline: 0,
          viewWindowMode: 'explicit',
          viewWindow: {
            max: max_chart_value
          }
        },
        intervals: { 'lineWidth': 1.5, 'barWidth': 0.3 },
    };

    var chart_lines = new google.visualization.LineChart(document.getElementById('chart_div'));

    // Set chart options
    chart_lines.draw(data, options);

    var data_norm = google.visualization.arrayToDataTable(header.concat(dat_norm));

    // Set chart options
    var options_norm = {'title':'Prediction vs Reality Difference',
      hAxis: {baseline: 0,
        viewWindowMode: 'explicit',
        viewWindow: {
          max: max_chart_value
        }
      },
      width:400,
      height:300};

    // Instantiate and draw our chart, passing in some options.
    var chart_norm = new google.visualization.ScatterChart(document.getElementById('chart_div2'));
    chart_norm.draw(data_norm, options_norm);
  }

  $scope.load_chart_api = function(){
    google.load('visualization', '1.0', {
      'packages':['corechart'],
      'callback':$scope.on_api_load
    });
  }

  $scope.do_auth = function(){
    $scope.backend_ready = true;
    var request = gapi.client.oauth2.userinfo.get();
    request.execute($scope.getEmailCallback);
  }

  $scope.handleAuthResult = function(callback){
    return function(authResult) {
      if (authResult && !authResult.error) {
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

  $scope.get_item_list = function(){
    gapi.client.tasktimer.tasks.listTasks().execute(function(resp){
      if (resp.error){
        console.log(resp);
      } else {
        $scope.$apply(function(){
          $scope.tasks = resp.items;
          var task_ids = _.map($scope.tasks, function(x) {
            return String(x.task_id);
          });
          $scope.posted_tasks = _.filter($scope.posted_tasks, function (x) {
            return !_.contains(task_ids, x);
          });
          $scope.drawChart();
        });
      }
    });
  }

  $scope.getEmailCallback = function(obj){
    $scope.$apply(function(){
      $scope.username = obj['email'];
      $scope.is_authorized = true;
      gapi.client.tasktimer.users.updateUser({
        'last_seen_email':obj['email']
      }).execute(function(resp) {
        if (resp.error){
          console.log(resp);
        }
      });
    })
    $scope.get_item_list();
  }

  $scope.update_actual = function(){
    $scope.elapsed = (($scope.actual_mins * 60.0) + $scope.actual_secs) * 1000
    if ($scope.start != null){
      var newtime = new Date().getTime();
      $scope.time = $scope.elapsed - Math.floor(newtime - $scope.start)
    } else {
      $scope.time = $scope.elapsed
    }
  }

  $scope.onTimeout = function(){
    var newtime = new Date().getTime();
    $scope.elapsed = Math.floor(newtime - $scope.start) + $scope.time;

    var secs_elapsed = $scope.elapsed / 1000;
    $scope.actual_mins = Math.floor(secs_elapsed / 60);
    $scope.actual_secs = Math.floor(secs_elapsed % 60);

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
      $scope.toggleTimer();
    }
    if($scope.time > 0.0){
      gapi.client.tasktimer.tasks.createTask(
          {'name':$scope.name,
           'estimate':$scope.estimate * 60,
           'actual':$scope.time/1000,
           'finished':true
          }).execute(function(resp) {
            if (resp.error){
              consoel.log(resp);
            } else{
              $scope.posted_tasks[String(resp.task_id)] = resp;
              $scope.$apply(function(){
                $scope.time = 0.0;
                $scope.actual_mins = 0.0;
                $scope.actual_secs = 0.0;
                $scope.estimated = 0.0;
                $scope.name = '';
                $scope.get_item_list();
              });
            }
          });
    }
  };
});
