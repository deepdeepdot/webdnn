/*
MIT License

Copyright (c) 2017 Machine Intelligence Laboratory (The University of Tokyo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/// <reference path="../graph_descriptor/graph_descriptor.ts" />
var WebDNN;
(function (WebDNN) {
    /**
     * `DescriptorRunner` executes computation based on `GraphDescriptor`.
     */
    class DescriptorRunner {
        constructor(option) {
            this.descriptor = null;
            this.ignoreCache = false;
        }
    }
    WebDNN.DescriptorRunner = DescriptorRunner;
})(WebDNN || (WebDNN = {}));
var WebDNN;
(function (WebDNN) {
    /**
     * Abstract buffer interface. Read/write transactions are regarded as asynchronous operation.
     */
    class Buffer {
        constructor(byteLength, backed) {
            this.byteLength = byteLength;
            this.backed = backed;
        }
    }
    WebDNN.Buffer = Buffer;
})(WebDNN || (WebDNN = {}));
/// <reference path="./buffer.ts" />
var WebDNN;
(function (WebDNN) {
    class BufferWebGPU extends WebDNN.Buffer {
        constructor(byteLength) {
            super(byteLength, 'webgpu');
            if (byteLength == 0) {
                byteLength = 4; //0 length buffer causes error
            }
            this.buffer = BufferWebGPU.webgpuHandler.createBuffer(new Uint8Array(byteLength));
            this.bufferView = new Uint8Array(this.buffer.contents);
        }
        // async: there may be platforms synchronization is needed before writing
        async write(src, dst_offset) {
            await BufferWebGPU.webgpuHandler.sync();
            let viewSameType = new src.constructor(this.bufferView.buffer);
            viewSameType.set(src, dst_offset);
        }
        async read(dst, src_offset = 0, length) {
            if (!dst) {
                throw new Error('dst cannot be null');
            }
            await BufferWebGPU.webgpuHandler.sync();
            if (this.byteLength === 0) {
                // nothing to read
                return;
            }
            let dst_constructor = dst.constructor; //e.g. Float32Array
            let viewSameType = new dst_constructor(this.bufferView.buffer, this.bufferView.byteOffset + src_offset * dst_constructor.BYTES_PER_ELEMENT, length);
            if (length === undefined) {
                length = viewSameType.length - src_offset;
            }
            dst.set(viewSameType);
            return;
        }
        static init(webgpuHandler) {
            this.webgpuHandler = webgpuHandler;
        }
        getWriteView(offset, length, number_type) {
            let viewSameType = new number_type(this.bufferView.buffer, this.bufferView.byteOffset + offset * number_type.BYTES_PER_ELEMENT, length);
            return viewSameType;
        }
        getReadView(offset, length, number_type) {
            let viewSameType = new number_type(this.bufferView.buffer, this.bufferView.byteOffset + offset * number_type.BYTES_PER_ELEMENT, length);
            return viewSameType;
        }
        async syncWriteViews() {
            // no sync needed
        }
        async syncReadViews() {
            // if the user awaits promise from final kernel execution, this function call is not needed.
            await BufferWebGPU.webgpuHandler.sync();
        }
    }
    WebDNN.BufferWebGPU = BufferWebGPU;
})(WebDNN || (WebDNN = {}));
/// <reference path="./buffer/buffer_webgpu.ts" />
var WebDNN;
(function (WebDNN) {
    class WebGPUHandler {
        async init() {
            if (!WebGPUHandler.isBrowserSupported)
                throw new Error('This browser does not support WebGPU');
            let context = document.createElement('canvas').getContext('webgpu');
            if (!context)
                throw new Error('WebGPURenderingContext initialization failed');
            this.context = context;
            this.commandQueue = context.createCommandQueue();
            this.pipelineStates = new Map();
        }
        createBuffer(arrayBuffer) {
            return this.context.createBuffer(arrayBuffer);
        }
        loadKernel(librarySource, namespace = '') {
            let library = this.context.createLibrary(librarySource);
            for (let name of library.functionNames) {
                let kernelFunction = library.functionWithName(name);
                let pipelineStates = this.context.createComputePipelineState(kernelFunction);
                this.pipelineStates.set(namespace + '.' + name, pipelineStates);
            }
        }
        createCommandBuffer() {
            return this.commandQueue.createCommandBuffer();
        }
        getPipelineStateByName(name) {
            let state = this.pipelineStates.get(name);
            if (!state) {
                throw TypeError(`Kernel function "${name}" is not loaded.`);
            }
            return state;
        }
        executeSinglePipelineState(name, threadgroupsPerGrid, threadsPerThreadgroup, buffers, getCompletedPromise) {
            let commandBuffer = this.createCommandBuffer();
            let commandEncoder = commandBuffer.createComputeCommandEncoder();
            commandEncoder.setComputePipelineState(this.getPipelineStateByName(name));
            for (let i = 0; i < buffers.length; i++) {
                let buffer = buffers[i];
                let wgbuf;
                if (buffer instanceof WebDNN.BufferWebGPU) {
                    wgbuf = buffer.buffer;
                }
                else {
                    // cannot perform (buffer instanceof WebGPUBuffer) currently
                    wgbuf = buffer;
                }
                commandEncoder.setBuffer(wgbuf, 0, i);
            }
            commandEncoder.dispatch(threadgroupsPerGrid, threadsPerThreadgroup);
            commandEncoder.endEncoding();
            let promise = null;
            if (getCompletedPromise) {
                promise = commandBuffer.completed;
            }
            commandBuffer.commit();
            return promise;
        }
        async sync() {
            let commandBuffer = this.createCommandBuffer();
            let commandEncoder = commandBuffer.createComputeCommandEncoder();
            commandEncoder.setComputePipelineState(this.getPipelineStateByName('basic.sync'));
            commandEncoder.dispatch({
                width: 1,
                height: 1,
                depth: 1
            }, {
                width: 1,
                height: 1,
                depth: 1
            });
            commandEncoder.endEncoding();
            let promise = commandBuffer.completed;
            commandBuffer.commit();
            return promise;
        }
    }
    WebDNN.WebGPUHandler = WebGPUHandler;
    WebGPUHandler.isBrowserSupported = 'WebGPURenderingContext' in window && 'WebGPUComputeCommandEncoder' in window;
})(WebDNN || (WebDNN = {}));
///<reference path="./weight_decoder.ts" />
var WebDNN;
(function (WebDNN) {
    class WeightDecoderRaw {
        async decode(data, memory_layout) {
            return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
        }
    }
    WebDNN.WeightDecoderRaw = WeightDecoderRaw;
})(WebDNN || (WebDNN = {}));
///<reference path="./weight_decoder_raw.ts" />
///<reference path="./weight_decoder.ts" />
var WebDNN;
(function (WebDNN) {
    class WeightDecoderEightbit {
        async decode(data, memory_layout) {
            let dst = new Float32Array(memory_layout.total_size);
            let data_view = new DataView(data.buffer, data.byteOffset);
            let src_offset = 0;
            while (src_offset < data.length) {
                let dst_offset = data_view.getInt32(src_offset, true);
                src_offset += 4;
                let body_size = data_view.getInt32(src_offset, true);
                src_offset += 4;
                let scale = data_view.getFloat32(src_offset, true);
                src_offset += 8;
                let scaled_table = new Float32Array(256);
                for (let i = 0; i < 256; i++) {
                    scaled_table[i] = WeightDecoderEightbit.decode_table[i & 0x7F] * scale * (i < 128 ? 1.0 : -1.0);
                }
                // do decode
                let src_data_view = new Uint8Array(data.buffer, data.byteOffset + src_offset, body_size);
                let inflate = new Zlib.Inflate(src_data_view);
                let decompressed = inflate.decompress();
                let dec_size = decompressed.length;
                for (let s = 0; s < dec_size; s++) {
                    dst[dst_offset++] = scaled_table[decompressed[s]];
                }
                src_offset += body_size;
            }
            return dst;
        }
    }
    WeightDecoderEightbit.decode_table = [0.0, 2.750000021e-06, 7.249999726e-06, 1.875000089e-05, 3.624999954e-05, 5.874999624e-05, 8.624999464e-05,
        1.437500032e-04, 2.312500001e-04, 3.187500115e-04, 4.062500084e-04, 5.187499919e-04, 6.562499912e-04,
        7.937499322e-04, 9.312499315e-04, 1.218750025e-03, 1.656249980e-03, 2.093750052e-03, 2.531250007e-03,
        2.968749963e-03, 3.406249918e-03, 3.843750106e-03, 4.281249829e-03, 4.843750037e-03, 5.531250034e-03,
        6.218749564e-03, 6.906249560e-03, 7.593749557e-03, 8.281249553e-03, 8.968749084e-03, 9.656248614e-03,
        1.109374966e-02, 1.328125037e-02, 1.546875015e-02, 1.765624993e-02, 1.984374970e-02, 2.203124948e-02,
        2.421874925e-02, 2.640625089e-02, 2.859375067e-02, 3.078125045e-02, 3.296874836e-02, 3.515625000e-02,
        3.734375164e-02, 3.953124955e-02, 4.171875119e-02, 4.390624911e-02, 4.671875015e-02, 5.015625060e-02,
        5.359374732e-02, 5.703124776e-02, 6.046874821e-02, 6.390624493e-02, 6.734374911e-02, 7.078124583e-02,
        7.421874255e-02, 7.765624672e-02, 8.109374344e-02, 8.453124017e-02, 8.796874434e-02, 9.140624106e-02,
        9.484373778e-02, 9.828124195e-02, 1.054687500e-01, 1.164062470e-01, 1.273437440e-01, 1.382812560e-01,
        1.492187530e-01, 1.601562500e-01, 1.710937470e-01, 1.820312440e-01, 1.929687560e-01, 2.039062530e-01,
        2.148437500e-01, 2.257812470e-01, 2.367187440e-01, 2.476562560e-01, 2.585937381e-01, 2.695312500e-01,
        2.804687619e-01, 2.914062440e-01, 3.023437560e-01, 3.132812381e-01, 3.242187500e-01, 3.351562619e-01,
        3.460937440e-01, 3.570312560e-01, 3.679687381e-01, 3.789062500e-01, 3.898437619e-01, 4.007812440e-01,
        4.117187560e-01, 4.226562381e-01, 4.335937500e-01, 4.445312619e-01, 4.585937560e-01, 4.757812321e-01,
        4.929687381e-01, 5.101562142e-01, 5.273437500e-01, 5.445312262e-01, 5.617187023e-01, 5.789062381e-01,
        5.960937142e-01, 6.132812500e-01, 6.304687262e-01, 6.476562023e-01, 6.648437381e-01, 6.820312142e-01,
        6.992186904e-01, 7.164062262e-01, 7.335937023e-01, 7.507811785e-01, 7.679687142e-01, 7.851561904e-01,
        8.023436666e-01, 8.195312023e-01, 8.367186785e-01, 8.539061546e-01, 8.710936904e-01, 8.882811666e-01,
        9.054686427e-01, 9.226561785e-01, 9.398436546e-01, 9.570311308e-01, 9.742186666e-01, 9.914061427e-01, 1.0,
    ];
    WebDNN.WeightDecoderEightbit = WeightDecoderEightbit;
})(WebDNN || (WebDNN = {}));
///<reference path="./weight_decoder.ts" />
///<reference path="./weight_decoder_raw.ts" />
///<reference path="./weight_decoder_eightbit.ts" />
var WebDNN;
(function (WebDNN) {
    function get_weight_decoder(name) {
        switch (name) {
            case 'raw':
                return new WebDNN.WeightDecoderRaw();
            case 'eightbit':
                return new WebDNN.WeightDecoderEightbit();
            default:
                throw new Error('Unknown weight encoding');
        }
    }
    WebDNN.get_weight_decoder = get_weight_decoder;
})(WebDNN || (WebDNN = {}));
var WebDNN;
(function (WebDNN) {
    var util;
    (function (util) {
        const NOT_SCHEDULED = -1;
        /**
         *  Schedule function which is called too much frequently.
         */
        class DispatchScheduler {
            constructor() {
                this.scheduledCallbackId = NOT_SCHEDULED;
            }
            /**
             * Register scheduled function. If already other function is scheduled, it is canceled and dispatcher will dispatch only
             * function which is registered at last.
             * @param fn scheduled function
             */
            request(fn) {
                this.fn = fn;
                if (this.scheduledCallbackId == NOT_SCHEDULED) {
                    this.scheduledCallbackId = requestAnimationFrame(() => this.forceDispatch());
                }
            }
            /**
             * Dispatch scheduled function just now. If no function is scheduled, dispatcher do nothing.
             */
            forceDispatch() {
                if (this.scheduledCallbackId == NOT_SCHEDULED)
                    return;
                this.cancel();
                this.fn();
            }
            /**
             * Cancel scheduled function. If no function is scheduled, dispatcher do nothing.
             */
            cancel() {
                if (this.scheduledCallbackId == NOT_SCHEDULED)
                    return;
                cancelAnimationFrame(this.scheduledCallbackId);
                this.scheduledCallbackId = NOT_SCHEDULED;
            }
        }
        util.DispatchScheduler = DispatchScheduler;
    })(util = WebDNN.util || (WebDNN.util = {}));
})(WebDNN || (WebDNN = {}));
/// <reference path="./util/dispatch_scheduler.ts" />
let transformDelegate = url => url;
/**
 * Fetch delegate function.
 * Every fetch call in WebDNN is delegated to this function.
 * As default, `window.fetch` is set.
 * @type {(input:RequestInfo, init?:RequestInit)=>Promise<Response>}
 */
let fetchDelegate = window.fetch;
var WebDNN;
(function (WebDNN) {
    /**
     * Register delegate function for transform url
     * @param url url which will be transformed
     */
    function transformUrl(url) {
        return transformDelegate(url);
    }
    WebDNN.transformUrl = transformUrl;
    /**
     * Register delegate function for transform url
     * @param delegate delegate function
     */
    function registerTransformDelegate(delegate) {
        transformDelegate = delegate;
    }
    WebDNN.registerTransformDelegate = registerTransformDelegate;
    /**
     * Register delegate function for fetch
     * @param delegate delegate function
     */
    function registerFetchDelegate(delegate) {
        fetchDelegate = delegate;
    }
    WebDNN.registerFetchDelegate = registerFetchDelegate;
    /**
     * Fetch function. WebDNN API use this fetch function instead of original fetch function.
     * @param input Requested url
     * @param init Additional information about fetch
     * @returns Response
     */
    function fetch(input, init) {
        return fetchDelegate(input, init);
    }
    WebDNN.fetch = fetch;
    /**
     * Read `Response.body` stream as ArrayBuffer. This function provide progress information by callback.
     * @param res Response object
     * @param callback Callback function.
     * @returns ArrayBuffer
     */
    function readArrayBufferProgressively(res, callback) {
        if (!callback || !res.body)
            return res.arrayBuffer();
        let contentLength = res.headers.get('Content-Length');
        if (!contentLength)
            return res.arrayBuffer();
        const total = parseInt(contentLength);
        let buffer = new Uint8Array(total);
        let loaded = 0;
        let reader = res.body.getReader();
        let callbackScheduler = new WebDNN.util.DispatchScheduler();
        function accumulateLoadedSize(chunk) {
            buffer.set(chunk.value, loaded);
            loaded += chunk.value.length;
            if (callback) {
                callbackScheduler.request(() => callback(loaded, total));
            }
            if (loaded == total) {
                callbackScheduler.forceDispatch();
                return buffer.buffer;
            }
            else {
                return reader.read().then(accumulateLoadedSize);
            }
        }
        return reader.read().then(accumulateLoadedSize);
    }
    WebDNN.readArrayBufferProgressively = readArrayBufferProgressively;
})(WebDNN || (WebDNN = {}));
/// <reference path="./graph_descriptor.ts" />
/// <reference path="../buffer/buffer_webgpu.ts" />
/// <reference path="../webgpu_handler.ts" />
/// <reference path="./descriptor_runner.ts" />
/// <reference path="../decoder/get_weight_decoder.ts" />
/// <reference path="../fetch.ts" />
/// <reference path="../graph_descriptor/graph_descriptor_webgpu.ts" />
var WebDNN;
(function (WebDNN) {
    class DescriptorRunnerWebGPU extends WebDNN.DescriptorRunner {
        constructor(option) {
            super(option);
            this.backendName = 'webgpu';
            if (!WebDNN.WebGPUHandler.isBrowserSupported) {
                throw new Error('WebGPU is not supported on this browser');
            }
        }
        async init() {
            // initialize webgpu, build kernels
            this.shaderLanguage = 'metal';
            this.webgpuHandler = new WebDNN.WebGPUHandler();
            await this.webgpuHandler.init();
            WebDNN.BufferWebGPU.init(this.webgpuHandler);
            this.init_basic_kernels();
        }
        init_basic_kernels() {
            this.webgpuHandler.loadKernel('kernel void sync(){}', 'basic');
        }
        async load(directory, progressCallback) {
            let graph_url = `${directory}/graph_${this.backendName}.json`;
            if (this.ignoreCache) {
                graph_url += '?t=' + Date.now();
            }
            graph_url = WebDNN.transformUrl(graph_url);
            let graph_fetch = await WebDNN.fetch(graph_url);
            if (!graph_fetch.ok) {
                throw new Error(`${graph_url} cannot be loaded`);
            }
            this.descriptor = await graph_fetch.json();
            await this.compile();
            let weight_url = `${directory}/weight_${this.backendName}.bin`;
            if (this.ignoreCache) {
                weight_url += '?t=' + Date.now();
            }
            weight_url = WebDNN.transformUrl(weight_url);
            let weights_data_ab = await WebDNN.readArrayBufferProgressively(await WebDNN.fetch(weight_url, progressCallback), progressCallback);
            await this.loadWeights(new Uint8Array(weights_data_ab));
        }
        setDescriptor(descriptor) {
            this.descriptor = descriptor;
        }
        async compile() {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            this.webgpuHandler.loadKernel(this.descriptor.kernel_source, 'descriptor');
            this.dataBuffer = new WebDNN.BufferWebGPU(this.descriptor.memory_layout.total_size * Float32Array.BYTES_PER_ELEMENT);
            this.metaBuffers = [];
            for (let i = 0; i < this.descriptor.exec_infos.length; i++) {
                let exec_info = this.descriptor.exec_infos[i];
                let buf = new WebDNN.BufferWebGPU(exec_info.meta_buffer.length * Float32Array.BYTES_PER_ELEMENT);
                await buf.write(new Uint8Array(exec_info.meta_buffer));
                this.metaBuffers.push(buf);
            }
        }
        async loadWeights(data) {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.dataBuffer)
                throw new Error('Data buffer is not initialized');
            let decoder = WebDNN.get_weight_decoder(this.descriptor.weight_encoding);
            await this.dataBuffer.write(await decoder.decode(data, this.descriptor.memory_layout));
        }
        async getInputViews() {
            if (this.inputViews)
                return this.inputViews;
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.dataBuffer)
                throw new Error('Data buffer is not initialized');
            let views = [];
            for (let i = 0; i < this.descriptor.inputs.length; i++) {
                let var_alloc = this.descriptor.memory_layout.allocations[this.descriptor.inputs[i]];
                views.push(this.dataBuffer.getWriteView(var_alloc.offset, var_alloc.size, Float32Array));
            }
            this.inputViews = views;
            return views;
        }
        async getOutputViews() {
            if (this.outputViews)
                return this.outputViews;
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.dataBuffer)
                throw new Error('Data buffer is not initialized');
            let views = [];
            for (let i = 0; i < this.descriptor.outputs.length; i++) {
                let var_alloc = this.descriptor.memory_layout.allocations[this.descriptor.outputs[i]];
                views.push(this.dataBuffer.getReadView(var_alloc.offset, var_alloc.size, Float32Array));
            }
            this.outputViews = views;
            return views;
        }
        async run() {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.inputViews || !this.outputViews)
                throw new Error('getInputViews and getOutputViews must be called prior to run');
            if (!this.dataBuffer)
                throw new Error('Data buffer is not initialized');
            if (!this.metaBuffers)
                throw new Error('Meta buffer is not initialized');
            let dataBuffer = this.dataBuffer;
            let metaBuffers = this.metaBuffers;
            if (WebDNN.DEBUG) {
                let records = [];
                let totalElapsedTime = 0;
                for (let i = 0; i < this.descriptor.exec_infos.length; i++) {
                    let exec_info = this.descriptor.exec_infos[i];
                    let start = performance.now();
                    await this.webgpuHandler.executeSinglePipelineState('descriptor.' + exec_info.entry_func_name, exec_info.threadgroups_per_grid, exec_info.threads_per_thread_group, [dataBuffer, metaBuffers[i]], true);
                    let elapsedTime = performance.now() - start;
                    records.push({
                        'Kernel': exec_info.entry_func_name,
                        'Elapsed time [ms]': elapsedTime
                    });
                    totalElapsedTime += elapsedTime;
                }
                let summary = Array.from(Object.values(records.reduce((summary, record) => {
                    if (!(record['Kernel'] in summary)) {
                        summary[record['Kernel']] = {
                            'Kernel': record['Kernel'],
                            'Count': 0,
                            'Elapsed time [ms]': 0,
                        };
                    }
                    summary[record['Kernel']]['Count']++;
                    summary[record['Kernel']]['Elapsed time [ms]'] += record['Elapsed time [ms]'];
                    return summary;
                }, {})));
                summary.forEach(record => record['Ratio [%]'] = (record['Elapsed time [ms]'] / totalElapsedTime).toFixed(2));
                console.table(records);
                console.table(summary);
            }
            else {
                let complete_promise = null;
                for (let i = 0; i < this.descriptor.exec_infos.length; i++) {
                    let exec_info = this.descriptor.exec_infos[i];
                    let is_last = i == this.descriptor.exec_infos.length - 1;
                    complete_promise = this.webgpuHandler.executeSinglePipelineState('descriptor.' + exec_info.entry_func_name, exec_info.threadgroups_per_grid, exec_info.threads_per_thread_group, [dataBuffer, metaBuffers[i]], is_last);
                }
                await complete_promise; //wait to finish final kernel
            }
        }
    }
    WebDNN.DescriptorRunnerWebGPU = DescriptorRunnerWebGPU;
})(WebDNN || (WebDNN = {}));
/// <reference path="./graph_descriptor.ts" />
/// <reference path="../webgpu_handler.ts" />
/// <reference path="./descriptor_runner.ts" />
/// <reference path="../decoder/get_weight_decoder.ts" />
/// <reference path="../fetch.ts" />
/// <reference path="../graph_descriptor/graph_descriptor_webassembly.ts" />
var WebDNN;
(function (WebDNN) {
    class DescriptorRunnerWebassembly extends WebDNN.DescriptorRunner {
        constructor(option) {
            super();
            this.backendName = 'webassembly';
            this.worker_promise_reject_func = null;
            this.worker_initial_error = null;
            if (typeof Worker === 'undefined') {
                throw new Error('WebWorker is needed for WebAssembly backend');
            }
            if (typeof WebAssembly !== 'object') {
                console.warn('WebAssembly is not supported on this browser, trying to use asm.js code');
            }
        }
        init() {
            //nothing to do
            return Promise.resolve();
        }
        async load(directory, progressCallback) {
            let graph_url = `${directory}/graph_${this.backendName}.json`;
            if (this.ignoreCache) {
                graph_url += '?t=' + Date.now();
            }
            graph_url = WebDNN.transformUrl(graph_url);
            let graph_fetch = await WebDNN.fetch(graph_url);
            if (!graph_fetch.ok) {
                throw new Error(`${graph_url} cannot be loaded`);
            }
            this.descriptor = await graph_fetch.json();
            // for browsers which does not support wasm, try asm.js code
            let kernel_backend = typeof WebAssembly === 'object' ? 'webassembly' : 'asmjs';
            let worker_entry_js_path = `${directory}/kernels_${kernel_backend}.js`;
            if (this.ignoreCache) {
                worker_entry_js_path += '?t=' + Date.now();
            }
            worker_entry_js_path = WebDNN.transformUrl(worker_entry_js_path);
            this.worker_entry_js_path = worker_entry_js_path;
            await this.compile();
            let weight_url = `${directory}/weight_${this.backendName}.bin`;
            if (this.ignoreCache) {
                weight_url += '?t=' + Date.now();
            }
            weight_url = WebDNN.transformUrl(weight_url);
            let weights_data_ab = await WebDNN.readArrayBufferProgressively(await WebDNN.fetch(weight_url), progressCallback);
            await this.loadWeights(new Uint8Array(weights_data_ab));
        }
        setDescriptor(descriptor) {
            this.descriptor = descriptor;
        }
        compile() {
            let worker = new Worker(this.worker_entry_js_path);
            worker.onerror = (event) => {
                console.error(event);
                // console.error('Worker Exception: ' + event.message);
                if (this.worker_promise_reject_func) {
                    this.worker_promise_reject_func(event);
                }
                else {
                    this.worker_initial_error = event;
                }
            };
            let promise = new Promise((resolve, reject) => {
                // occurs when this.worker_entry_js_path is 404
                if (this.worker_initial_error)
                    return reject(this.worker_initial_error);
                this.worker_promise_reject_func = reject;
                worker.onmessage = (event) => {
                    if (event.data === 0) {
                        resolve();
                    }
                    else {
                        console.error(event.data);
                        worker.terminate();
                        reject(new Error(event.data));
                    }
                };
            });
            this.worker = worker;
            return promise;
        }
        async loadWeights(weightsData) {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.worker)
                throw new Error('Worker is not initialized');
            let decoder = WebDNN.get_weight_decoder(this.descriptor.weight_encoding);
            let weight_data = await decoder.decode(weightsData, this.descriptor.memory_layout);
            let worker = this.worker;
            let promise = new Promise((resolve, reject) => {
                this.worker_promise_reject_func = reject;
                worker.onmessage = (event) => {
                    if (event.data === 0) {
                        resolve();
                    }
                    else {
                        console.log(event.data);
                        worker.terminate();
                        reject(new Error(event.data));
                    }
                };
                worker.postMessage({ type: 'weight', data: weight_data });
            });
            return promise;
        }
        async getInputViews() {
            if (this.inputViews)
                return this.inputViews;
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            let views = [];
            for (let i = 0; i < this.descriptor.inputs.length; i++) {
                let var_alloc = this.descriptor.memory_layout.allocations[this.descriptor.inputs[i]];
                views.push(new Float32Array(var_alloc.size));
            }
            this.inputViews = views;
            return views;
        }
        async getOutputViews() {
            if (this.outputViews)
                return this.outputViews;
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            let views = [];
            for (let i = 0; i < this.descriptor.outputs.length; i++) {
                let var_alloc = this.descriptor.memory_layout.allocations[this.descriptor.outputs[i]];
                views.push(new Float32Array(var_alloc.size));
            }
            this.outputViews = views;
            return views;
        }
        async run() {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.inputViews || !this.outputViews)
                throw new Error('getInputViews and getOutputViews must be called prior to run');
            if (!this.worker)
                throw new Error('Worker is not initialized');
            let descriptor = this.descriptor;
            let worker = this.worker;
            let inputViews = this.inputViews;
            let outputViews = this.outputViews;
            let promise = new Promise((resolve, reject) => {
                // TODO: better way not to generate function on every run
                this.worker_promise_reject_func = reject;
                worker.onmessage = (event) => {
                    if (Array.isArray(event.data)) {
                        for (let i = 0; i < event.data.length; i++) {
                            outputViews[i].set(event.data[i]);
                        }
                        resolve();
                    }
                    else {
                        console.log(event.data);
                        worker.terminate();
                        reject(new Error(event.data));
                    }
                };
                let inputs = [];
                for (let i = 0; i < descriptor.inputs.length; i++) {
                    let var_alloc = descriptor.memory_layout.allocations[descriptor.inputs[i]];
                    inputs.push({ offset: var_alloc.offset, size: var_alloc.size, data: inputViews[i] });
                }
                let outputs = [];
                for (let i = 0; i < descriptor.outputs.length; i++) {
                    let var_alloc = descriptor.memory_layout.allocations[descriptor.outputs[i]];
                    outputs.push({ offset: var_alloc.offset, size: var_alloc.size });
                }
                worker.postMessage({ type: 'run', inputs: inputs, outputs: outputs });
            });
            return promise;
        }
    }
    WebDNN.DescriptorRunnerWebassembly = DescriptorRunnerWebassembly;
})(WebDNN || (WebDNN = {}));
/// <reference path="./graph_descriptor.ts" />
///<reference path="../fetch.ts" />
///<reference path="../graph_descriptor/graph_descriptor_fallback.ts" />
var WebDNN;
(function (WebDNN) {
    class DescriptorRunnerFallback extends WebDNN.DescriptorRunner {
        constructor() {
            super(...arguments);
            this.backendName = 'fallback';
        }
        init() {
            //nothing to do
            return Promise.resolve();
        }
        async load(directory, progressCallback) {
            let graph_url = `${directory}/graph_${this.backendName}.json`;
            if (this.ignoreCache) {
                graph_url += '?t=' + Date.now();
            }
            graph_url = WebDNN.transformUrl(graph_url);
            let graph_fetch = await WebDNN.fetch(graph_url);
            if (!graph_fetch.ok) {
                throw new Error(`${graph_url} cannot be loaded`);
            }
            this.descriptor = await graph_fetch.json();
            await this.compile();
            let weight_url = `${directory}/weight_${this.backendName}.bin`;
            if (this.ignoreCache) {
                weight_url += '?t=' + Date.now();
            }
            weight_url = WebDNN.transformUrl(weight_url);
            let weights_data_ab = await WebDNN.readArrayBufferProgressively(await WebDNN.fetch(weight_url), progressCallback);
            await this.loadWeights(new Uint8Array(weights_data_ab));
        }
        setDescriptor(descriptor) {
            this.descriptor = descriptor;
        }
        async compile() {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            let descriptor = this.descriptor;
            this.compileKernel();
            this.rawArray = new Float32Array(descriptor.memory_layout.total_size);
            this.variableArrays = new Map();
            for (let name in descriptor.memory_layout.allocations) {
                let alloc = descriptor.memory_layout.allocations[name];
                this.variableArrays.set(name, new Float32Array(this.rawArray.buffer, alloc.offset * Float32Array.BYTES_PER_ELEMENT, alloc.size));
            }
        }
        compileKernel() {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            let dnn_fallback_kernel = null;
            eval(this.descriptor.kernel_source);
            this.kernelObj = dnn_fallback_kernel;
        }
        async loadWeights(weightsData) {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.rawArray)
                throw new Error('Raw array is not loaded');
            // when weight format becomes not flat array (such as using quantization), the interface should be changed
            let decoder = WebDNN.get_weight_decoder(this.descriptor.weight_encoding);
            this.rawArray.set(await decoder.decode(weightsData, this.descriptor.memory_layout));
        }
        async run() {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.variableArrays)
                throw new Error('Variable map is not initialized');
            if (!this.inputViews || !this.outputViews)
                throw new Error('getInputViews and getOutputViews must be called prior to run');
            let descriptor = this.descriptor;
            let variableArrays = this.variableArrays;
            let run_entry_date = Date.now();
            let last_progress_date = Date.now(); //in milliseconds
            for (let i = 0; i < this.descriptor.exec_infos.length; i++) {
                let current_date = Date.now();
                if (current_date - last_progress_date >= 1000) {
                    let elapsed_ms = current_date - run_entry_date;
                    console.log(`Processed ${i}/${this.descriptor.exec_infos.length} kernels in ${elapsed_ms} ms`);
                    last_progress_date = current_date;
                    await this.wait_to_display();
                }
                let exec_info = this.descriptor.exec_infos[i];
                let input_arrays = exec_info.inputs.map((name) => variableArrays.get(name));
                let output_arrays = exec_info.outputs.map((name) => variableArrays.get(name));
                this.kernelObj[exec_info.entry_func_name](input_arrays, output_arrays, exec_info.call_option);
            }
            console.log(`Processed ${this.descriptor.exec_infos.length}/${this.descriptor.exec_infos.length} kernels in ${Date.now() - run_entry_date} ms`);
        }
        async wait_to_display() {
            // let console.log to be displayed, and prevent freeze
            return new Promise(function (resolve) {
                setTimeout(resolve, 10);
            });
        }
        async getInputViews() {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.variableArrays)
                throw new Error('Variable map is not initialized');
            if (this.inputViews)
                return this.inputViews;
            let variableArrays = this.variableArrays;
            let views = this.descriptor.inputs.map((name) => variableArrays.get(name));
            this.inputViews = views;
            return views;
        }
        async getOutputViews() {
            if (!this.descriptor)
                throw new Error('Descriptor is not loaded');
            if (!this.variableArrays)
                throw new Error('Variable map is not initialized');
            if (this.outputViews)
                return this.outputViews;
            let variableArrays = this.variableArrays;
            let views = this.descriptor.outputs.map((name) => variableArrays.get(name));
            this.outputViews = views;
            return views;
        }
    }
    WebDNN.DescriptorRunnerFallback = DescriptorRunnerFallback;
})(WebDNN || (WebDNN = {}));
///<reference path="./descriptor_runner/descriptor_runner.ts" />
///<reference path="./descriptor_runner/descriptor_runner_webgpu.ts" />
///<reference path="./descriptor_runner/descriptor_runner_webassembly.ts" />
///<reference path="./descriptor_runner/descriptor_runner_fallback.ts" />
var WebDNN;
(function (WebDNN) {
    WebDNN.backends = {
        'webgpu': WebDNN.DescriptorRunnerWebGPU,
        'webassembly': WebDNN.DescriptorRunnerWebassembly,
        'fallback': WebDNN.DescriptorRunnerFallback,
    };
    WebDNN.backendName = 'none';
    WebDNN.DEBUG = false;
    async function initBackend(backendName, option) {
        if (!(backendName in WebDNN.backends))
            throw new Error(`Unknown backend: "${backendName}"`);
        let runner;
        try {
            runner = new WebDNN.backends[backendName](option);
            await runner.init();
        }
        catch (ex) {
            console.warn(`Failed to initialize ${backendName} backend: ${ex}`);
            return false;
        }
        WebDNN.runner = runner;
        WebDNN.backendName = backendName;
        return true;
    }
    async function init(backendOrder, backendOptions = {}) {
        if (!backendOrder) {
            backendOrder = ['webgpu', 'webassembly'];
        }
        else if (typeof backendOrder === 'string') {
            backendOrder = [backendOrder];
        }
        backendOrder = backendOrder.slice();
        if (backendOrder.indexOf('fallback') === -1)
            backendOrder.concat(['fallback']);
        while (backendOrder.length > 0) {
            let backendName = backendOrder.shift();
            if (await initBackend(backendName, backendOptions[backendName]))
                return WebDNN.backendName;
        }
        throw new Error('No backend is available');
    }
    WebDNN.init = init;
    /**
     * Prepare backend interface and load model data at once. Internally calls init().
     * @param directory URL of directory that contains graph descriptor files (e.g. graph_fallback.json)
     * @param initOption Initialize option
     * @return Interface to input/output data and run the model.
     */
    async function prepareAll(directory, initOption = {}) {
        let backendOrder = initOption.backendOrder;
        if (!backendOrder) {
            backendOrder = ['webgpu', 'webassembly'];
        }
        else if (typeof backendOrder === 'string') {
            backendOrder = [backendOrder];
        }
        backendOrder = backendOrder.slice();
        if (backendOrder.indexOf('fallback') === -1)
            backendOrder.concat(['fallback']);
        let backendOptions = initOption.backendOptions || {};
        while (backendOrder.length > 0) {
            let backendName = backendOrder.shift();
            if (!(await initBackend(backendName, backendOptions[backendName])))
                continue;
            if (!WebDNN.runner)
                continue;
            try {
                await WebDNN.runner.load(directory, initOption.progressCallback);
            }
            catch (ex) {
                console.warn(`Model loading failed for ${backendName} backend. Trying next backend: ${ex.message}`);
            }
            let inputViews = await WebDNN.runner.getInputViews();
            let outputViews = await WebDNN.runner.getOutputViews();
            return {
                backendName: backendName,
                inputViews: inputViews,
                outputViews: outputViews,
                run: WebDNN.runner.run.bind(WebDNN.runner)
            };
        }
        throw new Error('No backend is available');
    }
    WebDNN.prepareAll = prepareAll;
})(WebDNN || (WebDNN = {}));
var WebDNN;
(function (WebDNN) {
    var Math;
    (function (Math) {
        /**
         * Return indices of the top-K largest samples.
         * @param arr array
         * @param k number of indices
         * @returns {number[]} indices of top-K largest samples
         */
        function argmax(arr, k = 1) {
            let stack = [[0, arr.length]];
            let workspace = {};
            while (stack.length > 0) {
                let fromTo = stack.shift(), from = fromTo[0], to = fromTo[1], pivot = arr[to - 1], left = from, right = to - 2, tmp;
                if (from >= to)
                    continue;
                while (true) {
                    while (arr[left] > pivot && left <= right)
                        left++;
                    while (arr[right] <= pivot && left <= right)
                        right--;
                    if (left >= right)
                        break;
                    tmp = arr[left] || left;
                    arr[left] = arr[right] || right;
                    arr[right] = tmp;
                    tmp = workspace[left] || left;
                    workspace[left] = workspace[right] || right;
                    workspace[right] = tmp;
                }
                if (left != to - 1) {
                    arr[to - 1] = arr[left];
                    arr[left] = pivot;
                    tmp = workspace[to - 1] || to - 1;
                    workspace[to - 1] = workspace[left] || left;
                    workspace[left] = tmp;
                }
                stack.unshift([from, left]);
                if (left + 1 < k)
                    stack.unshift([left + 1, to]);
            }
            let result = [];
            for (let i = 0; i < k; i++) {
                result.push(i in workspace ? workspace[i] : i);
            }
            return result;
        }
        Math.argmax = argmax;
        /**
         * Return indices of the top-K smallest samples.
         * @param arr array
         * @param k number of indices
         * @returns {number[]} indices of top-K smallest samples
         */
        function argmin(arr, k = 1) {
            let stack = [[0, arr.length]];
            let workspace = {};
            while (stack.length > 0) {
                let fromTo = stack.shift(), from = fromTo[0], to = fromTo[1], pivot = arr[to - 1], left = from, right = to - 2, tmp;
                if (from >= to)
                    continue;
                while (true) {
                    while (arr[left] < pivot && left <= right)
                        left++;
                    while (arr[right] >= pivot && left <= right)
                        right--;
                    if (left >= right)
                        break;
                    tmp = arr[left] || left;
                    arr[left] = arr[right] || right;
                    arr[right] = tmp;
                    tmp = workspace[left] || left;
                    workspace[left] = workspace[right] || right;
                    workspace[right] = tmp;
                }
                if (left != to - 1) {
                    arr[to - 1] = arr[left];
                    arr[left] = pivot;
                    tmp = workspace[to - 1] || to - 1;
                    workspace[to - 1] = workspace[left] || left;
                    workspace[left] = tmp;
                }
                stack.unshift([from, left]);
                if (left + 1 < k)
                    stack.unshift([left + 1, to]);
            }
            let result = [];
            for (let i = 0; i < k; i++) {
                result.push(i in workspace ? workspace[i] : i);
            }
            return result;
        }
        Math.argmin = argmin;
    })(Math = WebDNN.Math || (WebDNN.Math = {}));
})(WebDNN || (WebDNN = {}));
var WebDNN;
(function (WebDNN) {
    function getBackendAvailabilityWebGPU() {
        return 'WebGPUComputeCommandEncoder' in window;
    }
    function getBackendAvailabilityWebAssembly() {
        return 'Worker' in window;
    }
    function getBackendAvailabilityFallback() {
        return true;
    }
    /**
     * Check backend availability
     * @returns List of backend availability and default selected backend order
     */
    function getBackendAvailability() {
        let status = {
            'webgpu': getBackendAvailabilityWebGPU(),
            'webassembly': getBackendAvailabilityWebAssembly(),
            'fallback': getBackendAvailabilityFallback()
        };
        let order = ['webgpu', 'webassembly', 'fallback'].filter(backend => status[backend]);
        return {
            status: status,
            defaultOrder: order
        };
    }
    WebDNN.getBackendAvailability = getBackendAvailability;
})(WebDNN || (WebDNN = {}));
//# sourceMappingURL=webdnn.js.map