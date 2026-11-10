"use client";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import { ChevronLeft, ChevronRight, ArrowDownUp } from "lucide-react";
import { Button } from "./ui/button";
import { Empty } from "./common";
export function DataTable<T>({
  columns,
  data,
  total,
  page = 1,
  limit = 20,
  onPage,
}: {
  columns: ColumnDef<T>[];
  data: T[];
  total: number;
  page?: number;
  limit?: number;
  onPage?: (page: number) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  // eslint-disable-next-line react-hooks/incompatible-library -- React Compiler is not enabled; TanStack Table owns its stable instance methods.
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="panel overflow-hidden">
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-2"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <ArrowDownUp size={10} />
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.length && <Empty />}
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 text-[11px] text-muted-foreground">
        <span>
          {total
            ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total.toLocaleString()}`
            : "0 records"}
        </span>
        {onPage && (
          <div className="flex items-center gap-2">
            <Button
              aria-label="Previous page"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <span>Page {page}</span>
            <Button
              aria-label="Next page"
              variant="outline"
              size="sm"
              disabled={page * limit >= total}
              onClick={() => onPage(page + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
