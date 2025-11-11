"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MorgenTaskNotesPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var MorgenTaskNotesPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.updating = /* @__PURE__ */ new Set();
    this.context = null;
    this.lastSeen = /* @__PURE__ */ new Map();
    this.settingsSignature = null;
  }
  async onload() {
    this.ensureContext();
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof import_obsidian.TFile && file.extension === "md") {
          void this.syncFile(file);
        }
      })
    );
    this.addCommand({
      id: "sync-active-note",
      name: "Sync active note with Morgen",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          await this.syncFile(file);
        }
      }
    });
    this.addCommand({
      id: "sync-all-tasknotes",
      name: "Sync all TaskNotes files",
      callback: async () => {
        await this.syncAll();
      }
    });
    this.app.workspace.onLayoutReady(() => {
      void this.syncAll();
    });
  }
  getTaskNotesSettings() {
    const tn = this.app?.plugins?.getPlugin?.("tasknotes");
    return tn?.settings ?? null;
  }
  computeSettingsSignature(settings) {
    const payload = {
      statusField: settings?.fieldMapping?.status?.trim() || "status",
      defaultTaskStatus: settings?.defaultTaskStatus?.trim() || "",
      customStatuses: settings?.customStatuses?.map((status) => ({
        value: status?.value?.trim() || "",
        isCompleted: !!status?.isCompleted
      })) ?? [],
      userFields: settings?.userFields?.map((field) => ({
        key: field?.key?.trim() || "",
        type: field?.type?.trim() || ""
      })) ?? []
    };
    return JSON.stringify(payload);
  }
  buildContext(settings) {
    const statusField = settings?.fieldMapping?.status?.trim() || "status";
    const statusCompletionMap = /* @__PURE__ */ new Map();
    const registerStatus = (value, completed) => {
      if (!value)
        return;
      statusCompletionMap.set(value.toLowerCase(), completed);
    };
    const statuses = settings?.customStatuses && settings.customStatuses.length > 0 ? settings.customStatuses : [
      { value: "open", isCompleted: false },
      { value: "in-progress", isCompleted: false },
      { value: "blocked", isCompleted: false },
      { value: "todo", isCompleted: false },
      { value: "waiting", isCompleted: false },
      { value: "done", isCompleted: true },
      { value: "completed", isCompleted: true },
      { value: "complete", isCompleted: true }
    ];
    for (const status of statuses) {
      if (!status?.value)
        continue;
      registerStatus(status.value, !!status.isCompleted);
    }
    registerStatus("done", true);
    registerStatus("completed", true);
    registerStatus("complete", true);
    registerStatus("open", false);
    registerStatus("in-progress", false);
    registerStatus("blocked", false);
    registerStatus("todo", false);
    const incompleteStatuses = Array.from(statusCompletionMap.entries()).filter(([, completed]) => !completed).map(([value]) => value);
    const completedStatuses = Array.from(statusCompletionMap.entries()).filter(([, completed]) => completed).map(([value]) => value);
    const defaultOpenStatus = settings?.defaultTaskStatus?.toLowerCase() || incompleteStatuses.find((status) => status !== "blocked") || "open";
    const defaultCompletedStatus = completedStatuses.find((status) => status === "done") || completedStatuses[0] || "done";
    const completedField = this.resolveCompletedField(settings);
    return {
      statusField,
      completedField,
      statusCompletionMap,
      defaultCompletedStatus,
      defaultOpenStatus
    };
  }
  resolveCompletedField(settings) {
    const userFields = settings?.userFields || [];
    const directMatch = userFields.find(
      (field) => field.type === "boolean" && field.key?.toLowerCase() === "completed"
    );
    if (directMatch?.key) {
      return directMatch.key;
    }
    const firstBoolean = userFields.find((field) => field.type === "boolean" && field.key);
    if (firstBoolean?.key) {
      return firstBoolean.key;
    }
    return "completed";
  }
  normalizeStatus(value) {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized.length ? normalized : void 0;
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const normalized = this.normalizeStatus(entry);
        if (normalized)
          return normalized;
      }
    }
    return void 0;
  }
  normalizeCompleted(value) {
    if (typeof value === "boolean")
      return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true")
        return true;
      if (normalized === "false")
        return false;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const normalized = this.normalizeCompleted(entry);
        if (normalized !== void 0)
          return normalized;
      }
    }
    return void 0;
  }
  ensureContext() {
    const settings = this.getTaskNotesSettings();
    const signature = this.computeSettingsSignature(settings);
    if (!this.context || this.settingsSignature !== signature) {
      if (this.settingsSignature && this.settingsSignature !== signature) {
        this.lastSeen.clear();
      }
      this.context = this.buildContext(settings);
      this.settingsSignature = signature;
    }
    return this.context;
  }
  async syncFile(file) {
    if (this.updating.has(file.path))
      return;
    const context = this.ensureContext();
    if (!context)
      return;
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    if (!frontmatter)
      return;
    const { statusField, completedField, statusCompletionMap, defaultCompletedStatus, defaultOpenStatus } = context;
    const rawStatus = frontmatter[statusField];
    const normalizedStatus = this.normalizeStatus(rawStatus);
    const statusCompletion = normalizedStatus !== void 0 ? statusCompletionMap.get(normalizedStatus) ?? (normalizedStatus === "true" ? true : normalizedStatus === "false" ? false : void 0) : void 0;
    const hasRelevantField = normalizedStatus !== void 0 || frontmatter[completedField] !== void 0;
    if (!hasRelevantField) {
      this.lastSeen.delete(file.path);
      return;
    }
    const rawCompleted = frontmatter[completedField];
    const normalizedCompleted = this.normalizeCompleted(rawCompleted);
    const previous = this.lastSeen.get(file.path);
    const statusKnown = normalizedStatus !== void 0 && statusCompletionMap.has(normalizedStatus);
    const booleanKnown = typeof normalizedCompleted === "boolean";
    const previousCompleted = previous?.completed;
    const previousStatus = previous?.status;
    const currentCompleted = booleanKnown ? normalizedCompleted : void 0;
    const statusChanged = normalizedStatus !== previousStatus;
    const completedChanged = currentCompleted !== previousCompleted;
    let finalStatus = normalizedStatus;
    let finalCompleted = statusKnown && statusCompletion !== void 0 ? statusCompletion : booleanKnown ? normalizedCompleted : void 0;
    if (booleanKnown && (!statusKnown || !statusChanged && completedChanged)) {
      finalStatus = normalizedCompleted ? defaultCompletedStatus : defaultOpenStatus;
      finalCompleted = normalizedCompleted;
    } else if (statusKnown) {
      finalStatus = normalizedStatus;
      finalCompleted = statusCompletion;
    } else if (booleanKnown) {
      finalStatus = normalizedCompleted ? defaultCompletedStatus : defaultOpenStatus;
      finalCompleted = normalizedCompleted;
    }
    const needsStatusUpdate = finalStatus !== void 0 && finalStatus !== normalizedStatus && statusCompletionMap.has(finalStatus);
    const needsCompletedUpdate = typeof finalCompleted === "boolean" && finalCompleted !== normalizedCompleted;
    if (!needsStatusUpdate && !needsCompletedUpdate) {
      this.lastSeen.set(file.path, {
        status: finalStatus ?? normalizedStatus,
        completed: typeof finalCompleted === "boolean" ? finalCompleted : currentCompleted
      });
      return;
    }
    this.updating.add(file.path);
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (needsStatusUpdate && finalStatus) {
          fm[statusField] = finalStatus;
        }
        if (needsCompletedUpdate && typeof finalCompleted === "boolean") {
          fm[completedField] = finalCompleted;
        }
      });
    } finally {
      this.updating.delete(file.path);
      this.lastSeen.set(file.path, {
        status: finalStatus ?? normalizedStatus,
        completed: typeof finalCompleted === "boolean" ? finalCompleted : currentCompleted
      });
    }
  }
  async syncAll() {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      await this.syncFile(file);
    }
  }
};
