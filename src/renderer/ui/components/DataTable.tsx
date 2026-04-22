import type { ReactNode } from 'react';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
};

export const DataTable = <T,>({ columns, rows, emptyMessage = 'Sin registros.' }: { columns: Column<T>[]; rows: T[]; emptyMessage?: string }) => (
  <table className="data-table">
    <thead>
      <tr>{columns.map((column) => <th key={column.key}>{column.header}</th>)}</tr>
    </thead>
    <tbody>
      {rows.length === 0 ? (
        <tr><td colSpan={columns.length} className="empty-cell">{emptyMessage}</td></tr>
      ) : rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>)}
    </tbody>
  </table>
);
