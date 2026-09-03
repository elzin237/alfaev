function ProjectProgressHeader() {
  return (
    <div className="border-b border-zinc-200 px-6 py-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-wide text-zinc-900">
            PROGRES PROJEKATA
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            Praćenje statusa proizvodnih projekata po fazama realizacije.
          </p>
        </div>

        <button className="text-sm font-medium text-red-600 transition hover:text-red-700">
          Pogledaj sve
        </button>
      </div>
    </div>
  );
}

export default ProjectProgressHeader;
