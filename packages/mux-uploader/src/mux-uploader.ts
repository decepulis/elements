import { globalThis, document } from './polyfills';

import { UpChunk } from '@mux/upchunk';

import blockLayout from './layouts/block';
import { ProgressTypes } from './constants';

const rootTemplate = document.createElement('template');

rootTemplate.innerHTML = /*html*/ `
<style>
  :host {
    display: flex;
    flex-direction: column;
  }

  mux-uploader-drop {
    flex-grow: 1;
  }

  input[type="file"] {
    display: none;
  }
</style>

<input id="hidden-file-input" type="file" accept="video/*, audio/*" />
<mux-uploader-sr-text></mux-uploader-sr-text>
`;

type Endpoint = UpChunk['endpoint'] | undefined | null;
type DynamicChunkSize = UpChunk['dynamicChunkSize'] | undefined;

type ErrorDetail = {
  message: string;
  chunkNumber?: number;
  attempts?: number;
  file?: File;
};

// NOTE: Progress event is already determined on HTMLElement but have inconsistent types. Should consider renaming events (CJP)
export interface MuxUploaderElementEventMap extends Omit<HTMLElementEventMap, 'progress'> {
  uploadstart: CustomEvent<{ file: File; chunkSize: number }>;
  chunkattempt: CustomEvent<{
    chunkNumber: number;
    chunkSize: number;
    file?: File;
  }>;
  chunksuccess: CustomEvent<{
    chunk: number;
    chunkSize: number;
    attempts: number;
    timeInterval: number;
    // Note: This should be more explicitly typed in Upchunk. (TD).
    response: any;
    file?: File;
  }>;
  uploaderror: CustomEvent<ErrorDetail>;
  progress: CustomEvent<number | { progress: number; file: File }>;
  success: CustomEvent<undefined | null | { file: File }>;
  'file-ready': CustomEvent<File | File[]>;
  'queue-started': CustomEvent<{ files: File[] }>;
  'queue-complete': CustomEvent<undefined | null>;
}

interface MuxUploaderElement extends HTMLElement {
  addEventListener<K extends keyof MuxUploaderElementEventMap>(
    type: K,
    listener: (this: HTMLMediaElement, ev: MuxUploaderElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof MuxUploaderElementEventMap>(
    type: K,
    listener: (this: HTMLMediaElement, ev: MuxUploaderElementEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

class MuxUploaderElement extends globalThis.HTMLElement implements MuxUploaderElement {
  static get observedAttributes() {
    return [
      'pausable',
      'type',
      'no-drop',
      'no-progress',
      'no-status',
      'no-retry',
      'max-file-size',
      'use-large-file-workaround',
      'multiple',
      'max-concurrent-uploads',
    ];
  }

  protected _endpoint: Endpoint;
  protected _upload?: UpChunk; // For backward compatibility with single file uploads

  /**
   * A Map tracking all currently active upload instances.
   * Key: A unique file identifier
   * Value: The UpChunk instance managing the upload
   *
   * The number of entries (this._uploads.size) represents how many uploads
   * are currently in progress.
   */
  protected _uploads: Map<string, UpChunk> = new Map();

  /**
   * A queue of files waiting to be uploaded.
   * Files are processed from this queue as upload slots become available,
   * based on the maxConcurrentUploads limit.
   */
  protected _uploadQueue: File[] = [];

  constructor() {
    super();

    const shadow = this.attachShadow({ mode: 'open' });

    // Always attach the root template
    shadow.appendChild(rootTemplate.content.cloneNode(true));

    // Attach a layout
    this.updateLayout();

    // Synchronize the hiddenFileInput's multiple attribute with the component's multiple attribute
    if (this.hiddenFileInput) {
      this.hiddenFileInput.multiple = this.multiple;
    }

    this.hiddenFileInput?.addEventListener('change', () => {
      const files = this.hiddenFileInput?.files;
      if (!files || files.length === 0) return;

      this.toggleAttribute('file-ready', true);

      if (this.multiple) {
        const fileArray = Array.from(files);
        this.dispatchEvent(
          new CustomEvent('file-ready', {
            composed: true,
            bubbles: true,
            detail: fileArray,
          })
        );
      } else {
        const file = files[0];
        this.dispatchEvent(
          new CustomEvent('file-ready', {
            composed: true,
            bubbles: true,
            detail: file,
          })
        );
      }
    });
  }

  connectedCallback() {
    this.addEventListener('file-ready', this.handleFiles);
    this.addEventListener('reset', this.resetState);
  }

  disconnectedCallback() {
    this.removeEventListener('file-ready', this.handleFiles, false);
    this.removeEventListener('reset', this.resetState);
  }

  attributeChangedCallback() {
    this.updateLayout();
  }

  protected get hiddenFileInput() {
    return this.shadowRoot?.querySelector('#hidden-file-input') as HTMLInputElement;
  }

  get endpoint(): Endpoint {
    return this.getAttribute('endpoint') ?? this._endpoint;
  }

  set endpoint(value: Endpoint) {
    if (value === this.endpoint) return;
    if (typeof value === 'string') {
      this.setAttribute('endpoint', value);
    } else if (value == undefined) {
      this.removeAttribute('endpoint');
    }
    this._endpoint = value;
  }

  get type() {
    return (this.getAttribute('type') ?? undefined) as ProgressTypes[keyof ProgressTypes] | undefined;
  }

  set type(val: ProgressTypes[keyof ProgressTypes] | undefined) {
    if (val == this.type) return;
    if (!val) {
      this.removeAttribute('type');
    } else {
      this.setAttribute('type', val);
    }
  }

  get noDrop(): boolean {
    return this.hasAttribute('no-drop');
  }

  set noDrop(value: boolean) {
    this.toggleAttribute('no-drop', Boolean(value));
  }

  get noProgress(): boolean {
    return this.hasAttribute('no-progress');
  }

  set noProgress(value: boolean) {
    this.toggleAttribute('no-progress', Boolean(value));
  }

  get noStatus(): boolean {
    return this.hasAttribute('no-status');
  }

  set noStatus(value: boolean) {
    this.toggleAttribute('no-status', Boolean(value));
  }

  get noRetry(): boolean {
    return this.hasAttribute('no-retry');
  }

  set noRetry(value: boolean) {
    this.toggleAttribute('no-retry', Boolean(value));
  }

  get pausable() {
    return this.hasAttribute('pausable');
  }

  set pausable(value) {
    this.toggleAttribute('pausable', Boolean(value));
  }

  get dynamicChunkSize(): DynamicChunkSize {
    return this.hasAttribute('dynamic-chunk-size');
  }

  set dynamicChunkSize(value: DynamicChunkSize) {
    if (value === this.hasAttribute('dynamic-chunk-size')) return;
    if (value) {
      this.setAttribute('dynamic-chunk-size', '');
    } else {
      this.removeAttribute('dynamic-chunk-size');
    }
  }

  get useLargeFileWorkaround() {
    return this.hasAttribute('use-large-file-workaround');
  }

  set useLargeFileWorkaround(value: boolean | undefined) {
    if (value == this.useLargeFileWorkaround) return;
    this.toggleAttribute('use-large-file-workaround', !!value);
  }

  get maxFileSize(): number | undefined {
    const maxFileSize = this.getAttribute('max-file-size');
    return maxFileSize !== null ? parseInt(maxFileSize) : undefined;
  }

  set maxFileSize(value: number | undefined) {
    if (value) {
      this.setAttribute('max-file-size', value.toString());
    } else {
      this.removeAttribute('max-file-size');
    }
  }

  get chunkSize(): number | undefined {
    const chunkSize = this.getAttribute('chunk-size');
    return chunkSize !== null ? parseInt(chunkSize) : undefined;
  }

  set chunkSize(value: number | undefined) {
    if (value) {
      this.setAttribute('chunk-size', value.toString());
    } else {
      this.removeAttribute('chunk-size');
    }
  }

  get upload() {
    return this._upload;
  }

  get multiple(): boolean {
    return this.hasAttribute('multiple');
  }

  set multiple(value: boolean) {
    this.toggleAttribute('multiple', Boolean(value));
    if (this.hiddenFileInput) {
      this.hiddenFileInput.multiple = Boolean(value);
    }
  }

  get maxConcurrentUploads(): number {
    return parseInt(this.getAttribute('max-concurrent-uploads') || '3', 10);
  }

  set maxConcurrentUploads(value: number) {
    this.setAttribute('max-concurrent-uploads', value.toString());
  }

  get paused() {
    if (this.multiple) {
      // Return true only if all active uploads are paused
      if (this._uploads.size === 0) return false;
      for (const upload of this._uploads.values()) {
        if (!upload.paused) return false;
      }
      return true;
    }
    return this.upload?.paused ?? false;
  }

  set paused(value) {
    const boolVal = !!value;

    if (this.multiple) {
      for (const upload of this._uploads.values()) {
        if (boolVal && !upload.paused) {
          upload.pause();
        } else if (!boolVal && upload.paused) {
          upload.resume();
        }
      }
    } else {
      if (!this.upload) {
        console.warn('Pausing before an upload has begun is unsupported');
        return;
      }
      if (boolVal === this.paused) return;
      if (boolVal) {
        this.upload.pause();
      } else {
        this.upload.resume();
      }
    }

    this.toggleAttribute('paused', boolVal);
    this.dispatchEvent(new CustomEvent('pausedchange', { detail: boolVal }));
  }

  updateLayout() {
    const oldLayout = this.shadowRoot?.querySelector('mux-uploader-drop, div');
    if (oldLayout) {
      oldLayout.remove();
    }
    const newLayout = blockLayout(this);
    this.shadowRoot?.appendChild(newLayout);
  }

  setError(message: string) {
    this.setAttribute('upload-error', '');
    this.dispatchEvent(new CustomEvent('uploaderror', { detail: { message } }));
  }

  resetState() {
    this.removeAttribute('upload-error');
    this.removeAttribute('upload-in-progress');
    this.removeAttribute('upload-complete');
    // Reset file to ensure change/input events will fire, even if selecting the same file (CJP).
    this.hiddenFileInput.value = '';
    this._uploadQueue = [];
    this._uploads.clear();
  }

  handleFiles(evt: CustomEvent) {
    if (this.multiple && Array.isArray(evt.detail)) {
      // Handle multiple files:
      // 1. Add all files to the upload queue
      // 2. Start uploading up to maxConcurrentUploads files
      this._uploadQueue = [...evt.detail];
      this.setAttribute('upload-in-progress', '');

      this.dispatchEvent(
        new CustomEvent('queue-started', {
          detail: { files: [...this._uploadQueue] },
        })
      );

      this.processQueue();
    } else {
      // Handle single file upload
      this.startUpload(evt.detail);
    }
  }

  /**
   * Process available files from the queue, starting uploads
   * until we reach the maxConcurrentUploads limit.
   */
  processQueue() {
    // Start uploads until we reach the concurrent upload limit or the queue is empty
    while (this._uploads.size < this.maxConcurrentUploads && this._uploadQueue.length > 0) {
      const file = this._uploadQueue.shift();
      if (file) {
        this.startUpload(file);
      }
    }
  }

  /**
   * Start uploading a single file.
   *
   * This method:
   * 1. Creates an UpChunk instance for the file
   * 2. Adds it to the _uploads Map
   * 3. Sets up event handlers for the upload process
   *
   * @param file The file to upload
   */
  startUpload(file: File) {
    const endpoint = this.endpoint;
    const dynamicChunkSize = this.dynamicChunkSize;

    if (!endpoint) {
      this.setError(`No url or endpoint specified -- cannot startUpload`);
      // Bail early if no endpoint.
      return;
    } else {
      this.removeAttribute('upload-error');
    }

    try {
      const upload = UpChunk.createUpload({
        endpoint,
        dynamicChunkSize,
        file,
        maxFileSize: this.maxFileSize,
        chunkSize: this.chunkSize,
        useLargeFileWorkaround: this.useLargeFileWorkaround,
      });

      if (!this.multiple) {
        this._upload = upload;
      }

      // Create a unique identifier for this file upload
      const fileId = this.getUniqueFileId(file);
      this._uploads.set(fileId, upload);

      this.dispatchEvent(
        new CustomEvent('uploadstart', { detail: { file: upload.file, chunkSize: upload.chunkSize } })
      );
      this.setAttribute('upload-in-progress', '');

      if (upload.offline) {
        this.dispatchEvent(new CustomEvent('offline'));
      }

      upload.on('attempt', (event: any) => {
        this.dispatchEvent(
          new CustomEvent('chunkattempt', {
            ...event,
            detail: { ...event.detail, file },
          })
        );
      });

      upload.on('chunkSuccess', (event: any) => {
        this.dispatchEvent(
          new CustomEvent('chunksuccess', {
            ...event,
            detail: { ...event.detail, file },
          })
        );
      });

      upload.on('error', (event: any) => {
        this.setAttribute('upload-error', '');
        console.error('error handler', event.detail.message);
        this.dispatchEvent(
          new CustomEvent('uploaderror', {
            ...event,
            detail: { ...event.detail, file },
          })
        );

        // todo should we gate this on multiple?
        this.completeUpload(fileId);
      });

      upload.on('progress', (event: any) => {
        if (this.multiple) {
          this.dispatchEvent(
            new CustomEvent('progress', {
              ...event,
              detail: { progress: event.detail, file },
            })
          );
        } else {
          this.dispatchEvent(new CustomEvent('progress', event));
        }
      });

      upload.on('success', (event: any) => {
        if (this.multiple) {
          this.dispatchEvent(
            new CustomEvent('success', {
              ...event,
              detail: { ...event.detail, file },
            })
          );
        } else {
          this.removeAttribute('upload-in-progress');
          this.setAttribute('upload-complete', '');
          this.dispatchEvent(new CustomEvent('success', event));
        }

        this.completeUpload(fileId);
      });

      upload.on('offline', (event: any) => {
        this.dispatchEvent(new CustomEvent('offline', event));
      });

      upload.on('online', (event: any) => {
        this.dispatchEvent(new CustomEvent('online', event));
      });
    } catch (err) {
      if (err instanceof Error) {
        this.setError(err.message);
      }
    }
  }

  /**
   * Handle completion of an upload (success or error).
   *
   * This method:
   * 1. Removes the completed upload from the _uploads Map
   * 2. Processes the next item in the queue if available
   * 3. Fires appropriate events if all uploads are complete
   *
   * @param fileId The unique identifier of the completed upload
   */
  completeUpload(fileId: string) {
    this._uploads.delete(fileId);

    // Process next item in queue if any
    if (this._uploadQueue.length > 0) {
      this.processQueue();
    } else if (this._uploads.size === 0) {
      // All uploads are complete
      if (this.multiple) {
        this.removeAttribute('upload-in-progress');
        this.setAttribute('upload-complete', '');
        this.dispatchEvent(new CustomEvent('queue-complete'));
      }
    }
  }

  /**
   * Generate a unique identifier for a file upload
   * @param file The file to create an ID for
   * @returns A string identifier
   */
  protected getUniqueFileId(file: File): string {
    return `${file.name}-${file.size}-${Date.now()}`;
  }

  /**
   * Get the number of currently active uploads
   */
  get activeUploadsCount(): number {
    return this._uploads.size;
  }

  /**
   * Get the number of files waiting in the queue
   */
  get queuedFilesCount(): number {
    return this._uploadQueue.length;
  }
}

type MuxUploaderElementType = typeof MuxUploaderElement;
declare global {
  // eslint-disable-next-line
  var MuxUploaderElement: MuxUploaderElementType;
}

if (!globalThis.customElements.get('mux-uploader')) {
  globalThis.customElements.define('mux-uploader', MuxUploaderElement);
  globalThis.MuxUploaderElement = MuxUploaderElement;
}

export default MuxUploaderElement;
