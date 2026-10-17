/**
 * `GET /categories/{categoryId}/products?minPrice&maxPrice&cursor&limit` (AP2).
 *
 * Cheapest first, from the index's own sort order. The cursor is the opaque LastEvaluatedKey.
 */

import { catalogRepository } from '../../persistence/repositories/catalog.js';
import {
  parseCategoryIdPath,
  parseListCategoryQuery,
  toCategoryListingResponse,
} from '../../api/schemas/catalog.js';
import { httpRoute, ok } from '../../shared/http.js';

const catalog = catalogRepository();

export const handler = httpRoute('list-category', async (event) => {
  const categoryId = parseCategoryIdPath(event.pathParameters?.['categoryId']);
  const query = parseListCategoryQuery(event.queryStringParameters);

  const page = await catalog.listCategory({
    categoryId,
    ...(query.minPrice === undefined ? {} : { minPriceCents: query.minPrice }),
    ...(query.maxPrice === undefined ? {} : { maxPriceCents: query.maxPrice }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  });

  return ok(toCategoryListingResponse(page));
});
