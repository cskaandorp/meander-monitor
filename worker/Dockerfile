# miniforge base: conda/mamba preinstalled, conda-forge as the default channel.
# This is the reliable way to get pyorc's GDAL/OpenCV stack as binaries.
FROM condaforge/miniforge3:latest

WORKDIR /app

# Resolve the heavy env first, in its own layer, so it's cached across code
# changes. This build is minutes and hundreds of MB — expected for pyorc.
COPY environment.yml .
RUN mamba env update -n base -f environment.yml && mamba clean -afy

COPY worker.py .

# Unbuffered so container logs (docker compose logs -f) are live.
ENV PYTHONUNBUFFERED=1
CMD ["python", "worker.py"]
