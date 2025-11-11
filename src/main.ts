import { Plugin, TFile } from "obsidian";

interface TaskNotesStatusConfig {
	value: string;
	isCompleted: boolean;
}

interface TaskNotesUserField {
	key: string;
	type: string;
}

interface TaskNotesSettingsLike {
	fieldMapping?: {
		status?: string;
	};
	customStatuses?: TaskNotesStatusConfig[];
	defaultTaskStatus?: string;
	userFields?: TaskNotesUserField[];
}

interface SyncContext {
	statusField: string;
	completedField: string;
	statusCompletionMap: Map<string, boolean>;
	defaultCompletedStatus: string;
	defaultOpenStatus: string;
}

export default class MorgenTaskNotesPlugin extends Plugin {
	private updating = new Set<string>();
	private context: SyncContext | null = null;
	private lastSeen = new Map<string, { status?: string; completed?: boolean }>();
	private settingsSignature: string | null = null;

	async onload() {
		this.ensureContext();

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file instanceof TFile && file.extension === "md") {
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

	private getTaskNotesSettings(): TaskNotesSettingsLike | null {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const tn = (this.app as any)?.plugins?.getPlugin?.("tasknotes");
		return tn?.settings ?? null;
	}

	private computeSettingsSignature(settings: TaskNotesSettingsLike | null): string {
		const payload = {
			statusField: settings?.fieldMapping?.status?.trim() || "status",
			defaultTaskStatus: settings?.defaultTaskStatus?.trim() || "",
			customStatuses:
				settings?.customStatuses?.map((status) => ({
					value: status?.value?.trim() || "",
					isCompleted: !!status?.isCompleted
				})) ?? [],
			userFields:
				settings?.userFields?.map((field) => ({
					key: field?.key?.trim() || "",
					type: field?.type?.trim() || ""
				})) ?? []
		};

		return JSON.stringify(payload);
	}

	private buildContext(settings: TaskNotesSettingsLike | null): SyncContext {
		const statusField = settings?.fieldMapping?.status?.trim() || "status";

		const statusCompletionMap = new Map<string, boolean>();

		const registerStatus = (value: string, completed: boolean) => {
			if (!value) return;
			statusCompletionMap.set(value.toLowerCase(), completed);
		};

		const statuses =
			settings?.customStatuses && settings.customStatuses.length > 0
				? settings.customStatuses
				: [
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
			if (!status?.value) continue;
			registerStatus(status.value, !!status.isCompleted);
		}

		// Ensure canonical fallbacks exist
		registerStatus("done", true);
		registerStatus("completed", true);
		registerStatus("complete", true);
		registerStatus("open", false);
		registerStatus("in-progress", false);
		registerStatus("blocked", false);
		registerStatus("todo", false);

		const incompleteStatuses = Array.from(statusCompletionMap.entries())
			.filter(([, completed]) => !completed)
			.map(([value]) => value);
		const completedStatuses = Array.from(statusCompletionMap.entries())
			.filter(([, completed]) => completed)
			.map(([value]) => value);

		const defaultOpenStatus =
			settings?.defaultTaskStatus?.toLowerCase() ||
			incompleteStatuses.find((status) => status !== "blocked") ||
			"open";

		const defaultCompletedStatus =
			completedStatuses.find((status) => status === "done") ||
			completedStatuses[0] ||
			"done";

		const completedField = this.resolveCompletedField(settings);

		return {
			statusField,
			completedField,
			statusCompletionMap,
			defaultCompletedStatus,
			defaultOpenStatus
		};
	}

	private resolveCompletedField(settings: TaskNotesSettingsLike | null): string {
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

	private normalizeStatus(value: unknown): string | undefined {
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			return normalized.length ? normalized : undefined;
		}

		if (typeof value === "boolean") {
			return value ? "true" : "false";
		}

		if (Array.isArray(value)) {
			for (const entry of value) {
				const normalized = this.normalizeStatus(entry);
				if (normalized) return normalized;
			}
		}

		return undefined;
	}

	private normalizeCompleted(value: unknown): boolean | undefined {
		if (typeof value === "boolean") return value;
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			if (normalized === "true") return true;
			if (normalized === "false") return false;
		}
		if (Array.isArray(value)) {
			for (const entry of value) {
				const normalized = this.normalizeCompleted(entry);
				if (normalized !== undefined) return normalized;
			}
		}
		return undefined;
	}

	private ensureContext(): SyncContext | null {
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

	private async syncFile(file: TFile) {
		if (this.updating.has(file.path)) return;

		const context = this.ensureContext();
		if (!context) return;

		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		if (!frontmatter) return;

		const { statusField, completedField, statusCompletionMap, defaultCompletedStatus, defaultOpenStatus } =
			context;

		const rawStatus = frontmatter[statusField];
		const normalizedStatus = this.normalizeStatus(rawStatus);
		const statusCompletion =
			normalizedStatus !== undefined
				? statusCompletionMap.get(normalizedStatus) ??
				  (normalizedStatus === "true" ? true : normalizedStatus === "false" ? false : undefined)
				: undefined;

		const hasRelevantField =
			normalizedStatus !== undefined || frontmatter[completedField] !== undefined;
		if (!hasRelevantField) {
			this.lastSeen.delete(file.path);
			return;
		}

		const rawCompleted = frontmatter[completedField];
		const normalizedCompleted = this.normalizeCompleted(rawCompleted);

		const previous = this.lastSeen.get(file.path);
		const statusKnown = normalizedStatus !== undefined && statusCompletionMap.has(normalizedStatus);
		const booleanKnown = typeof normalizedCompleted === "boolean";

		const previousCompleted = previous?.completed;
		const previousStatus = previous?.status;

		const currentCompleted = booleanKnown ? normalizedCompleted : undefined;
		const statusChanged = normalizedStatus !== previousStatus;
		const completedChanged = currentCompleted !== previousCompleted;

		let finalStatus = normalizedStatus;
		let finalCompleted =
			statusKnown && statusCompletion !== undefined
				? statusCompletion
				: booleanKnown
				? normalizedCompleted
				: undefined;

		if (booleanKnown && (!statusKnown || (!statusChanged && completedChanged))) {
			finalStatus = normalizedCompleted ? defaultCompletedStatus : defaultOpenStatus;
			finalCompleted = normalizedCompleted;
		} else if (statusKnown) {
			finalStatus = normalizedStatus!;
			finalCompleted = statusCompletion;
		} else if (booleanKnown) {
			finalStatus = normalizedCompleted ? defaultCompletedStatus : defaultOpenStatus;
			finalCompleted = normalizedCompleted;
		}

		const needsStatusUpdate =
			finalStatus !== undefined &&
			finalStatus !== normalizedStatus &&
			statusCompletionMap.has(finalStatus);

		const needsCompletedUpdate =
			typeof finalCompleted === "boolean" &&
			finalCompleted !== normalizedCompleted;

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

	private async syncAll() {
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			await this.syncFile(file);
		}
	}
}

