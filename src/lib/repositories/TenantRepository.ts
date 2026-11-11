import { QueryFilter, Model, Types, UpdateQuery, QueryOptions } from "mongoose";

/**
 * Every method requires businessId as an explicit first argument and merges
 * it into the Mongo filter internally. This makes it a compile error to
 * write a tenant-scoped query without a businessId — the single highest-
 * leverage control against cross-tenant data leaks (see architecture
 * decision J-6). Never bypass this by calling `model.find()` directly on a
 * tenant-scoped collection.
 */
export class TenantRepository<T extends { businessId: Types.ObjectId }> {
  constructor(protected readonly model: Model<T>) {}

  find(businessId: Types.ObjectId | string, filter: QueryFilter<T> = {}, options?: QueryOptions<T>) {
    return this.model.find({ ...filter, businessId } as QueryFilter<T>, null, options);
  }

  findOne(businessId: Types.ObjectId | string, filter: QueryFilter<T> = {}, options?: QueryOptions<T>) {
    return this.model.findOne({ ...filter, businessId } as QueryFilter<T>, null, options);
  }

  findById(businessId: Types.ObjectId | string, id: Types.ObjectId | string, options?: QueryOptions<T>) {
    return this.model.findOne({ _id: id, businessId } as QueryFilter<T>, null, options);
  }

  create(businessId: Types.ObjectId | string, data: Partial<T>) {
    return this.model.create({ ...data, businessId });
  }

  updateOne(businessId: Types.ObjectId | string, filter: QueryFilter<T>, update: UpdateQuery<T>) {
    return this.model.updateOne({ ...filter, businessId } as QueryFilter<T>, update);
  }

  findByIdAndUpdate(
    businessId: Types.ObjectId | string,
    id: Types.ObjectId | string,
    update: UpdateQuery<T>,
    options?: QueryOptions<T>
  ) {
    return this.model.findOneAndUpdate({ _id: id, businessId } as QueryFilter<T>, update, {
      new: true,
      ...options,
    });
  }

  count(businessId: Types.ObjectId | string, filter: QueryFilter<T> = {}) {
    return this.model.countDocuments({ ...filter, businessId } as QueryFilter<T>);
  }
}
