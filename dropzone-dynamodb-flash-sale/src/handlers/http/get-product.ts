/**
 * `GET /products/{productId}` (AP1).
 *
 * One Query against one partition returns the product and every variant.
 */

import { catalogRepository } from '../../persistence/repositories/catalog.js';
import { parseProductIdPath, toProductResponse } from '../../api/schemas/catalog.js';
import { NotFoundError } from '../../shared/errors.js';
import { httpRoute, ok } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const catalog = catalogRepository();

export const handler = httpRoute('get-product', async (event) => {
  const productId = parseProductIdPath(event.pathParameters?.['productId']);
  addLogContext({ productId });

  const found = await catalog.getProduct(productId);
  if (found === null) {
    throw new NotFoundError('No such product');
  }

  return ok(toProductResponse(found.product, found.variants));
});
