// GitHub identifies the repository's LICENSE file. Keep its SPDX identifier as reported;
// do not infer a different license from the name, source list or dependencies.
export function repositoryLicense(repository) {
  const id = repository?.license?.spdx_id;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,199}$/.test(id)) {
    return "NOASSERTION";
  }
  return id;
}
