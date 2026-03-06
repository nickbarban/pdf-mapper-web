package com.nick.pdfmapper.api

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant

@RestController
@RequestMapping("/api")
class ProjectController(
  @Value("\${app.dataDir}") private val dataDir: String,
  private val mapper: ObjectMapper,
) {
  private fun projectDir(projectId: String): Path = Path.of(dataDir).resolve(projectId)
  private fun mappingsDir(projectId: String): Path = projectDir(projectId).resolve("mappings")

  data class ProjectDto(
    val id: String,
    val hasPdf: Boolean,
    val mappings: List<String>,
  )

  data class SaveResultDto(
    val projectId: String,
    val mappingName: String,
    val bytesWritten: Long,
    val savedAt: String,
  )

  @PostMapping("/projects")
  fun createProject(@RequestBody body: Map<String, String>): ProjectDto {
    val id = body["id"] ?: throw IllegalArgumentException("Missing project id")
    require(id.matches(Regex("^[a-zA-Z0-9_-]+$"))) { "Invalid project id: $id" }
    val dir = projectDir(id)
    Files.createDirectories(dir)
    return ProjectDto(id = id, hasPdf = false, mappings = emptyList())
  }

  @PostMapping("/project/{projectId}/pdf")
  fun uploadPdf(
    @PathVariable projectId: String,
    @RequestParam("file") file: MultipartFile,
  ): SaveResultDto {
    require(file.contentType?.contains("pdf") == true) { "File must be a PDF" }
    val dir = projectDir(projectId)
    Files.createDirectories(dir)
    val target = dir.resolve("source.pdf")
    file.inputStream.use { Files.copy(it, target, StandardCopyOption.REPLACE_EXISTING) }
    return SaveResultDto(
      projectId = projectId,
      mappingName = "source.pdf",
      bytesWritten = Files.size(target),
      savedAt = Instant.now().toString(),
    )
  }

  @GetMapping("/projects")
  fun listProjects(): List<ProjectDto> {
    val root = Path.of(dataDir)
    if (!Files.exists(root)) return emptyList()

    return Files.list(root)
      .filter { Files.isDirectory(it) }
      .map { dir ->
        val id = dir.fileName.toString()
        val pdf = dir.resolve("source.pdf")
        val mappings = dir.resolve("mappings")
        val mappingFiles = if (Files.exists(mappings)) {
          Files.list(mappings)
            .filter { it.fileName.toString().endsWith(".json") }
            .map { it.fileName.toString().removeSuffix(".json") }
            .sorted()
            .toList()
        } else emptyList()

        ProjectDto(id = id, hasPdf = Files.exists(pdf), mappings = mappingFiles)
      }
      .sorted { a, b -> a.id.compareTo(b.id) }
      .toList()
  }

  @GetMapping("/project/{projectId}/pdf")
  fun getPdf(@PathVariable projectId: String): ResponseEntity<ByteArray> {
    val pdfPath = projectDir(projectId).resolve("source.pdf")
    require(Files.exists(pdfPath)) { "PDF not found: $pdfPath" }
    val bytes = Files.readAllBytes(pdfPath)

    return ResponseEntity.ok()
      .header(HttpHeaders.CACHE_CONTROL, "no-store")
      .contentType(MediaType.APPLICATION_PDF)
      .body(bytes)
  }

  @GetMapping("/project/{projectId}/mapping")
  fun getMapping(
    @PathVariable projectId: String,
    @RequestParam name: String,
  ): ResponseEntity<JsonNode> {
    val path = mappingsDir(projectId).resolve("$name.json")
    require(Files.exists(path)) { "Mapping not found: $path" }
    val node = mapper.readTree(Files.readString(path))

    return ResponseEntity.ok()
      .header(HttpHeaders.CACHE_CONTROL, "no-store")
      .contentType(MediaType.APPLICATION_JSON)
      .body(node)
  }

  @PutMapping("/project/{projectId}/mapping", consumes = [MediaType.APPLICATION_JSON_VALUE])
  fun saveMapping(
    @PathVariable projectId: String,
    @RequestParam name: String,
    @RequestBody body: JsonNode,
  ): SaveResultDto {
    val dir = mappingsDir(projectId)
    Files.createDirectories(dir)

    val target = dir.resolve("$name.json")
    val pretty = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(body)
    Files.writeString(target, pretty)

    return SaveResultDto(
      projectId = projectId,
      mappingName = name,
      bytesWritten = Files.size(target),
      savedAt = Instant.now().toString(),
    )
  }

  @PostMapping("/project/{projectId}/mapping/clone")
  fun cloneMapping(
    @PathVariable projectId: String,
    @RequestParam from: String,
    @RequestParam to: String,
  ): SaveResultDto {
    val dir = mappingsDir(projectId)
    Files.createDirectories(dir)

    val src = dir.resolve("$from.json")
    require(Files.exists(src)) { "Source mapping not found: $src" }

    val dst = dir.resolve("$to.json")
    Files.copy(src, dst, StandardCopyOption.REPLACE_EXISTING)

    return SaveResultDto(
      projectId = projectId,
      mappingName = to,
      bytesWritten = Files.size(dst),
      savedAt = Instant.now().toString(),
    )
  }
}
