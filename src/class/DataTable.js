import _find from 'lodash/find';
import _findIndex from 'lodash/findIndex';
import _uniq from 'lodash/uniq';
import _map from 'lodash/map';
import _flatten from 'lodash/flatten';
import DataTableSource from './source/DataTableSource';
import { DataAnalytics, ModalChart } from '@entrylabs/tool';

class DataTable {
    #tables = [];
    #view;
    modal;
    selected;

    constructor() {
        this.#generateView();
    }

    removeAllBlocks() {
        const { blocks } = EntryStatic.getAllBlocks().find(
            ({ category }) => category === 'analysis'
        );
        blocks.forEach((blockType) => {
            Entry.Utils.removeBlockByType(blockType);
        });
        this.banAllBlock();
        this.clear();
    }

    banAllBlock() {
        Entry.playground.blockMenu.banClass('analysis');
    }

    unbanBlock() {
        Entry.playground.blockMenu.unbanClass('analysis');
    }

    get tables() {
        return this.#tables;
    }

    getTables(blockList = []) {
        return _uniq(
            _flatten(
                blockList
                    .filter((block) => {
                        const { _schema = {}, data = {} } = block || {};
                        if (!data.type) {
                            return false;
                        }
                        const { isFor, isNotFor = [] } = _schema;
                        const [key] = isNotFor;
                        return key && isFor && key === 'analysis';
                    })
                    .map((block) => {
                        const { params = [] } = block.data || {};
                        return params.filter((param) => {
                            if (typeof param !== 'string') {
                                return false;
                            }
                            return _find(this.#tables, { id: param });
                        });
                    })
            )
        ).map((tableId) => {
            const table = this.getSource(tableId);
            return table.toJSON();
        });
    }

    getSource(id) {
        if (!id) {
            console.warn('empty argument');
            return null;
        }
        return _find(this.#tables, { id });
    }

    getIndex({ id }) {
        if (!id) {
            console.warn('empty argument');
            return null;
        }
        return _findIndex(this.#tables, { id });
    }

    addSource(table, shouldTableMode = true) {
        // const isWorkspace = Entry.type === 'workspace';
        // if (shouldTableMode && isWorkspace) {
        //     Entry.do('playgroundChangeViewMode', 'table');
        // }
        let data = table || { name: Lang.Workspace.data_table };
        data.name = Entry.getOrderedName(data.name, this.#tables, 'name');
        const isDataTableSource = data instanceof DataTableSource;
        Entry.do('dataTableAddSource', isDataTableSource ? data : new DataTableSource(data));
    }

    removeSource(table) {
        Entry.do('dataTableRemoveSource', table);
    }

    changeItemPosition(start, end) {
        if (this.#tables.length) {
            this.#tables.splice(end, 0, this.#tables.splice(start, 1)[0]);
        }
    }

    async selectTable(table = {}) {
        if (this.tempDataAnalytics) {
            const temp = { ...this.tempDataAnalytics };
            const confirm = await entrylms.confirm(Lang.Menus.save_modified_table);
            if (confirm) {
                const result = this.saveTable(temp);
                if (!result) {
                    return;
                }
            }
        }
        const json = table.toJSON && table.toJSON();
        const { tab } = table;
        this.selected = table;
        this.dataAnalytics.setData({
            list: _map(this.tables, (table) => table.toJSON()),
            selectedIndex: 0,
            selected: this.tables[0]?.toJSON(),
        });
        this.hide();
        this.show();
        delete table.tab;
        delete this.tempDataAnalytics;
        return table;
    }

    saveTable = (dataAnalytics) => {
        const { id, table = [[]], charts = [], title } = dataAnalytics;
        if (!title) {
            Entry.toast.alert(
                Lang.DataAnalytics.fail_save_table,
                Lang.DataAnalytics.empty_table_name_content
            );
            return;
        }
        if (
            Entry.playground.isDuplicatedTableName(
                title,
                _.findIndex(this.tables, (table) => table.id === id)
            )
        ) {
            Entry.toast.alert(
                Lang.DataAnalytics.fail_save_table,
                Lang.DataAnalytics.duplicate_table_name_content
            );
            return;
        }
        const source = this.getSource(id);
        const data = ((this.tempDataAnalytics && this.tempDataAnalytics.table) || table).slice(1);
        if (source) {
            source.modal = null;
            source.setArray({
                data,
                chart: charts,
                fields: table[0],
                name: title,
            });
            Entry.playground.injectTable();
        }
        Entry.toast.success(
            Lang.DataAnalytics.saved_table_title,
            Lang.DataAnalytics.saved_table_content
        );
        delete this.tempDataAnalytics;
        Entry.playground.reloadPlayground();
        return true;
    };

    show() {
        if (!this.dataAnalytics) {
            this.#generateView();
        }
        this.dataAnalytics.show({ data: this.#tables });
    }

    hide() {
        this.dataAnalytics && this.dataAnalytics.hide();
        this.unbanBlock();
        Entry.playground.reloadPlayground();
        Entry.playground.refreshPlayground();
        Entry.dispatchEvent('dismissModal');
    }

    #generateView() {
        const view = document.createElement('div');
        view.className = 'table-modal';
        document.body.appendChild(view);
        this.dataAnalytics = new DataAnalytics({ container: view, data: {}, isShow: false })
            .on('submit', this.saveTable)
            .on('alert', ({ message, title = Lang.DataAnalytics.max_row_count_error_title }) =>
                entrylms.alert(message, title)
            )
            .on('toast', (message) => {
                const { title, content } = message;
                Entry.toast.alert(title, content);
            })
            .on('change', (dataAnalytics) => {
                this.tempDataAnalytics = dataAnalytics;
            })
            .on('close', () => {
                this.hide();
            })
            .on('addTable', () => {
                Entry.do('playgroundClickAddTable');
            });
    }

    getTableJSON() {
        return this.tables.filter(_.identity).map((v) => (v.toJSON ? v.toJSON() : v));
    }

    setTables(tables = []) {
        tables.forEach((table) => {
            this.addSource(table, false);
        });
    }

    setTableName(id, name) {
        if (!name) {
            return;
        }

        const source = this.getSource(id);
        if (!source) {
            return;
        }

        const { chart, array, fields } = source;
        source.setArray({ chart, data: array, fields, name });
    }

    showChart(tableId) {
        this.closeChart();
        const source = this.getSource(tableId);
        if (!source) {
            console.log(`not exist souce, table id: ${tableId}`);
            return;
        }
        if (!source.modal) {
            source.modal = this.createChart(source);
        }
        source.forceApply();
        source.modal.show();
        this.modal = source.modal;
    }

    closeChart() {
        if (this.modal && this.modal.isShow) {
            this.modal.hide();
        }
    }

    createChart(source) {
        const { chart = [], fields, rows } = source;
        const container = Entry.Dom('div', {
            class: 'entry-table-chart',
            parent: $('body'),
        })[0];
        return new ModalChart({
            data: {
                source: { fields, origin: rows, chart },
                togglePause: () => Entry.engine.togglePause(),
                stop: () => Entry.engine.toggleStop(),
                isIframe: self !== top,
            },
            container,
        });
    }

    clear() {
        this.#tables = [];
        this.modal = null;
    }
}

export default new DataTable();
