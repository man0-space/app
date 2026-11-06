import { useEffect, useMemo, useState } from 'react';
import { api, type OptionsResponse, type TaskCategoryGroup, type TaskTagItem } from '../lib/api';

let cachedOptions: OptionsResponse | null = null;
let inflightOptions: Promise<OptionsResponse> | null = null;

export function useOptions() {
  const [data, setData] = useState<OptionsResponse | null>(() => cachedOptions);

  useEffect(() => {
    if (cachedOptions) {
      setData(cachedOptions);
      return;
    }
    let cancelled = false;
    if (!inflightOptions) {
      inflightOptions = api
        .taskOptions()
        .then((res) => {
          cachedOptions = res;
          return res;
        })
        .finally(() => {
          inflightOptions = null;
        });
    }
    inflightOptions
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const categories: TaskCategoryGroup[] = useMemo(() => data?.tasks ?? [], [data]);
  const maxTaskTags = data?.maxTaskTags ?? 3;
  const allTags: TaskTagItem[] = useMemo(
    () => categories.flatMap((group) => group.tags),
    [categories],
  );
  const categoryByTag = useMemo(() => {
    const map = new Map<string, TaskCategoryGroup>();
    for (const group of categories) {
      for (const tag of group.tags) {
        map.set(tag.id.toLowerCase(), group);
      }
    }
    return map;
  }, [categories]);

  return {
    categories,
    allTags,
    maxTaskTags,
    categoryByTag,
  };
}
