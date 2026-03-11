package com.nick.pdfmapper.api

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDPageContentStream
import org.apache.pdfbox.pdmodel.font.PDType1Font
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import java.io.ByteArrayOutputStream
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
  private fun projectsRoot(): Path = Path.of(dataDir).resolve("projects")
  private fun projectDir(projectId: String): Path = projectsRoot().resolve(projectId)
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

  data class RenderRequest(
    val projectId: String,
    val templateName: String,
    val mappingName: String,
  )

  @PostMapping("/projects")
  fun createProject(@RequestBody body: Map<String, String>): ProjectDto {
    val id = body["id"] ?: throw IllegalArgumentException("Missing project id")
    require(id.matches(Regex("^[a-zA-Z0-9_-]+$"))) { "Invalid project id: $id" }
    Files.createDirectories(projectsRoot())
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

  @GetMapping("/templates")
  fun listTemplates(): List<String> {
    val templatesDir = Path.of(dataDir).resolve("templates")
    if (!Files.exists(templatesDir)) return emptyList()
    return Files.list(templatesDir)
      .filter { it.fileName.toString().endsWith(".pdf") }
      .map { it.fileName.toString().removeSuffix(".pdf") }
      .sorted()
      .toList()
  }

  @GetMapping("/projects")
  fun listProjects(): List<ProjectDto> {
    val root = projectsRoot()
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

  @PostMapping("/render", produces = [MediaType.APPLICATION_PDF_VALUE])
  fun renderPdf(@RequestBody req: RenderRequest): ResponseEntity<ByteArray> {
    val root = Path.of(dataDir)
    val templatePath = root.resolve("templates").resolve("${req.templateName}.pdf")
    val mappingPath = mappingsDir(req.projectId).resolve("${req.mappingName}.json")

    require(Files.exists(templatePath)) { "Template not found: $templatePath" }
    require(Files.exists(mappingPath)) { "Mapping not found: $mappingPath" }

    val mappingNode = mapper.readTree(Files.readString(mappingPath))
    val fieldsNode: JsonNode = when {
      mappingNode.isArray -> mappingNode
      mappingNode.has("fields") -> mappingNode["fields"]
      else -> mapper.createArrayNode()
    }

    val doc = PDDocument.load(Files.newInputStream(templatePath))
    try {
      // group fields by page number (1-based)
      val byPage: Map<Int, List<JsonNode>> = fieldsNode.mapNotNull { field ->
        if (!field.isObject) return@mapNotNull null
        val page = field.get("page")?.asInt(1) ?: 1
        page to field
      }.groupBy({ it.first }, { it.second })

      for ((pageNum, pageFields) in byPage) {
        if (pageNum < 1 || pageNum > doc.numberOfPages) continue
        val page = doc.getPage(pageNum - 1)
        val mediaBox = page.mediaBox
        val pageHeight = mediaBox.height

        val font = PDType1Font.HELVETICA
        val fontSize = 9f
        PDPageContentStream(doc, page, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
          cs.setFont(font, fontSize)

          for (field in pageFields) {
            val name = field.get("name")?.asText()
            val fieldType = field.get("type")?.asText()
            if (name == "companyType") continue
            if (fieldType == "checkbox") continue

            val valueNode = field.get("value")
            val custom = valueNode?.get("custom")?.asText(null)
            val parsed = valueNode?.get("parsed")?.asText(null)
            val text = (custom?.takeIf { it.isNotBlank() } ?: parsed)?.trim()
            if (text.isNullOrEmpty()) continue

            val x = field.get("x")?.asDouble() ?: 0.0
            val y = field.get("y")?.asDouble() ?: 0.0
            val w = field.get("w")?.asDouble() ?: 0.0
            val h = field.get("h")?.asDouble() ?: 0.0

            val pdfX = x.toFloat()
            val pdfY = (pageHeight - (y + h)).toFloat()
            val rectCenterX = pdfX + (w / 2).toFloat()
            val rectCenterY = pdfY + (h / 2).toFloat()

            val textWidth = (font.getStringWidth(text) / 1000f) * fontSize
            val rightBound = (pdfX + w.toFloat() - textWidth).coerceAtLeast(pdfX)
            val startX = (rectCenterX - textWidth / 2f).coerceIn(pdfX, rightBound)
            val baselineY = rectCenterY - fontSize * 0.35f

            cs.beginText()
            cs.newLineAtOffset(startX, baselineY)
            cs.showText(text)
            cs.endText()
          }
        }
      }

      val baos = ByteArrayOutputStream()
      doc.save(baos)
      val bytes = baos.toByteArray()

    return ResponseEntity.ok()
      .header(HttpHeaders.CACHE_CONTROL, "no-store")
      .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"${req.templateName}-rendered.pdf\"")
      .contentType(MediaType.APPLICATION_PDF)
      .body(bytes)
    } finally {
      doc.close()
    }
  }
}
