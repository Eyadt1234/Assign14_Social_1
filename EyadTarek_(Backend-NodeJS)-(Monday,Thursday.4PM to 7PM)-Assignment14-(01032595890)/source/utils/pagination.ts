import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type PaginationDto = z.infer<typeof paginationSchema>;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

//_________________________________________________________________________________//

//1: getSkip
export const getSkip = (query: PaginationDto): number => {
  return (query.page - 1) * query.limit;
};

//_________________________________________________________________________________//

//2: getPageMeta
export const getPageMeta = (query: PaginationDto, total: number): PageMeta => {
  const pages = Math.ceil(total / query.limit);
  return {
    page: query.page,
    limit: query.limit,
    total,
    pages,
    hasNext: query.page < pages,
    hasPrev: query.page > 1 && pages > 0,
  };
};
