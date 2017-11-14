/**
 * @file Customized queue functionality to multiplex tasks across the 
 * concurrency level specified by the user and rank them based on priority.
 * 
 * @author Clay McLeod
 */

const async = require("async");
const PRIORITY = {
  UPLOAD: 1,
  DOWNLOAD: 2,
  TOOL_INFO: 3,
};

/**
 * @todo Better exposure of debugging.
 */
const enableDebug = true;

/**
 * Log a message to the console if configured.
 * @param message Message to be output
 */
function log(...message: any[]): void {
  if (enableDebug) console.log.apply(this, message);
}

/**
 * Handles processing for download tasks.
 *
 * @param task Task to run. Required keys should be evident
 *             from the code below.
 * @param callback
 */
function downloadTask(task: any, callback: any) {
  log("Starting download task: ", task);

  task._rawFile.started = true;
  let process = (window as any).dx.downloadDxFile(
    task.remote_location,
    task.name,
    task.raw_size,
    task.local_location,
    (progress: Number) => {
      task._rawFile.status = progress;
    },
    (err: any, result: any) => {
      (window as any).VueApp.$store.commit("removeOperationProcess", {
        filename: task.remote_location,
      });

      if (err) {
        console.error(err);
        if (task._rawFile.cancelled) {
          (window as any).utils.resetFileStatus(task._rawFile);
          task._rawFile.checked = false;
          return callback(null, result);
        } else {
          task._rawFile.errored = true;
          return callback(err, null);
        }
      } else {
        // Success
        task._rawFile.status = 100;
        setTimeout(() => {
          task._rawFile.checked = true;
          task._rawFile.finished = true;
          return callback(null, task._rawFile);
        }, 1000);
      }
    }
  );

  (window as any).VueApp.$store.commit("addOperationProcess", {
    filename: task.remote_location,
    process,
  });
};


/**
 * Handles processing for upload tasks.
 *
 * @param task Task to run. Required keys should be evident
 *             from the code below.
 * @param callback
 */
function uploadTask(task: any, callback: any) {
  log("Starting upload task: ", task);

  task._rawFile.started = true;
  let process = (window as any).dx.uploadFile(
    task._rawFile,
    task.remote_location,
    (progress: any) => {
      if (!task._rawFile.cancelled) {
        task._rawFile.status = progress;
      }
    },
    (err: any, result: any) => {
      (window as any).VueApp.$store.commit("removeOperationProcess", {
        filename: task.local_location,
      });

      if (err) {
        console.error(err);
        if (task._rawFile.cancelled) {
          (window as any).utils.resetFileStatus(task._rawFile);
          task._rawFile.checked = false;
          return callback(null, result);
        } else {
          task._rawFile.errored = true;
          return callback(err, null);
        }
      }

      task._rawFile.status = 100;
      setTimeout(() => {
        task._rawFile.checked = true;
        task._rawFile.finished = true;
        return callback(err, result);
      }, 1000);
    }
  );

  (window as any).VueApp.$store.commit("addOperationProcess", {
    filename: task.local_location,
    process,
  });
}

/**
 * Handles processing for tool information tasks.
 *
 * @param task Task to run. Required keys should be evident
 *             from the code below.
 * @param callback
 */
function toolInfoTask(task: any, callback: any) {
  log("Tool info task: ", task);

  (window as any).dx.describeDXItem(
    task._rawTool.dx_location,
    (err: any, describe: any) => {
      if (err || !describe) {
        console.error(err);
        return callback(err, describe);
      }

      if (describe && describe.properties && describe.properties["sjcp-tool-url"]) {
        task._rawTool.isSJCPTool = true;
        task._rawTool.SJCPToolURL = describe.properties["sjcp-tool-url"];
      } else if (describe && describe.tags && describe.tags.includes("sjcp-project-data")) {
        task._rawTool.isSJCPDataRequest = true;
      }

      let dataUsage = 0;
      if (describe && "dataUsage" in describe) {
        dataUsage += describe.dataUsage * 1e9;
      }

      if ("sponsoredDataUsage" in describe) {
        dataUsage += describe.sponsoredDataUsage * 1e9;
      }

      task._rawTool.size = (window as any).utils.readableFileSize(dataUsage, true);
      return callback(null, describe);
    });
}

let workQueue = async.priorityQueue(
  (task: any, callback: any) => {
    if (task.type === "download") {
      downloadTask(task, callback);
    } else if (task.type === "upload") {
      uploadTask(task, callback);
    } else {
      toolInfoTask(task, callback);
    }
  }, 2
);

workQueue.drain = function () {
  log("The queue is now empty and awaiting more tasks.");
};

/**
 * Utility functions
 */

/**
 * Add a general task to the queue, prioritize it based on
 * what type of task it is.
 *
 * @param task The task to be added to the queue.
 */
function add(task: any) {
  log("Adding task to queue: ", task);
  if (task.type == "upload") {
    workQueue.push(task, PRIORITY.UPLOAD);
  } else if (task.type == "download") {
    workQueue.push(task, PRIORITY.DOWNLOAD);
  } else if (task.type == "toolInfo") {
    workQueue.push(task, PRIORITY.TOOL_INFO);
  } else {
    throw new Error("Invalid task type: " + task.type);
  }
}


/**
 * Adds an upload task to the queue.
 *
 * @param task Upload task to add to the queue.
 */
export function addUploadTask(task: any) {
  task.type = "upload";
  add(task);
}


/**
 * Adds a download task to the queue.
 *
 * @param task Download task to add to the queue.
 */
export function addDownloadTask(task: any) {
  task.type = "download";
  add(task);
}

/**
 * Adds an tool info task to the queue.
 *
 * @param task Tool info task to add to the queue.
 */
export function addToolInfoTask(task: any) {
  task.type = "toolInfo";
  add(task);
}

/**
 * Remove certain types of tasks from the queue.
 *
 * @param type Type of tasks to remove
 */
export function removeAllTaskOfType(type: string) {
  log("Removing all tasks of type", type);
  workQueue.remove(function (task: any) {
    return task.data.type === type;
  });
}