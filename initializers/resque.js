var os    = require('os');
var NR    = require('node-resque');

var resque = function(api, next){

  api.resque = {
    queue: null,
    multiWorker: null,
    scheduler: null,
    connectionDetails: api.config.tasks.redis || {},

    _start: function(api, next){
      var self = this;

      if(api.config.tasks.minTaskProcessors === 0 && api.config.tasks.maxTaskProcessors > 0){
        api.config.tasks.minTaskProcessors = 1;
      }

      self.startQueue(function(){
        self.startScheduler(function(){
          self.startMultiWorker(function(){
            next();
          });
        });
      });
    },

    _stop: function(api, next){
      var self = this;
      self.stopScheduler(function(){
        self.stopMultiWorker(function(){
          self.queue.end(function(){
            next();
          });
        });
      });
    },

    startQueue: function(callback){
      var self = this;
      self.queue = new NR.queue({connection: self.connectionDetails}, api.tasks.jobs, function(){
        callback();
      });
    },

    startScheduler: function(callback){
      var self = this;
      if(api.config.tasks.scheduler === true){
        self.scheduler = new NR.scheduler({connection: self.connectionDetails, timeout: api.config.tasks.timeout}, function(){
          self.scheduler.on('start',             function(){               api.log('resque scheduler started', 'info') })
          self.scheduler.on('end',               function(){               api.log('resque scheduler ended', 'info') })
          self.scheduler.on('poll',              function(){               api.log('resque scheduler polling', 'debug') })
          self.scheduler.on('working_timestamp', function(timestamp){      api.log('resque scheduler working timestamp ' + timestamp, 'debug') })
          self.scheduler.on('transferred_job',   function(timestamp, job){ api.log('resque scheduler enqueuing job ' + timestamp, 'debug', job) })

          self.scheduler.start();

          process.nextTick(function(){
            callback();
          });
        });
      } else {
        callback();
      }
    },

    stopScheduler: function(callback){
      var self = this;
      if(!self.scheduler){
        callback();
      } else {
        self.scheduler.end(function(){
          delete self.scheduler;
          callback();
        });
      }
    },

    startMultiWorker: function(callback){
      var self = this;
      
      self.multiWorker = new NR.multiWorker({
        connection:             api.resque.connectionDetails,
        queues:                 api.config.tasks.queues,
        timeout:                api.config.tasks.timeout,
        checkTimeout:           api.config.tasks.checkTimeout,
        minTaskProcessors:      api.config.tasks.minTaskProcessors,
        maxTaskProcessors:      api.config.tasks.maxTaskProcessors,
        maxEventLoopDelay:      api.config.tasks.maxEventLoopDelay,
        toDisconnectProcessors: api.config.tasks.toDisconnectProcessors,
      }, api.tasks.jobs, function(){
        // normal worker emitters
        self.multiWorker.on('start',             function(workerId){                      api.log("worker: started", 'info',                 {workerId: workerId}                                                            ); })
        self.multiWorker.on('end',               function(workerId){                      api.log("worker: ended", 'info',                   {workerId: workerId}                                                            ); })
        self.multiWorker.on('cleaning_worker',   function(workerId, worker, pid){         api.log("worker: cleaning old worker " + worker, 'info'                                                                            ); })
        self.multiWorker.on('poll',              function(workerId, queue){               api.log("worker: polling " + queue, 'debug',       {workerId: workerId}                                                            ); })
        self.multiWorker.on('job',               function(workerId, queue, job){          api.log("worker: working job " + queue, 'debug',   {workerId: workerId, job: {class: job.class, queue: job.queue}}                 ); })
        self.multiWorker.on('reEnqueue',         function(workerId, queue, job, plugin){  api.log("worker: reEnqueue job", 'debug',          {workerId: workerId, plugin: plugin, job: {class: job.class, queue: job.queue}} ); })
        self.multiWorker.on('success',           function(workerId, queue, job, result){  api.log("worker: job success " + queue, 'info',    {workerId: workerId, job: {class: job.class, queue: job.queue}, result: result} ); })
        self.multiWorker.on('pause',             function(workerId){                      api.log("worker: paused", 'debug', {workerId: workerId}                                                                            ); })

        self.multiWorker.on('failure',           function(workerId, queue, job, failure){ api.exceptionHandlers.task(failure, queue, job); })
        self.multiWorker.on('error',             function(workerId, queue, job, error){   api.exceptionHandlers.task(error, queue, job);   x})
        
        // multiWorker emitters
        self.multiWorker.on('internalError',     function(error){                         api.log(error, 'error'); })
        self.multiWorker.on('miltiWorkerAction', function(verb, delay){                   api.log("*** checked for worker status: " + verb + " (event loop delay: " + delay + "ms)", 'debug'); })
        
        if(api.config.tasks.minTaskProcessors > 0){
          self.multiWorker.start(function(){
            if(typeof callback === 'function'){ callback(); }
          });
        }else{
          if(typeof callback === 'function'){ callback(); }
        }
      });
    },

    stopMultiWorker: function(callback){
      var self = this;
      if(api.config.tasks.minWorkers > 0){
        self.multiWorker.stop(function(){
          api.log("task workers stopped");
          callback();
        });
      }else{
        callback();
      }
    }
  }

  if(api.resque.connectionDetails.fake == true){
    api.resque.connectionDetails.package = require('fakeredis');
  }

  next();

}

exports.resque = resque;
