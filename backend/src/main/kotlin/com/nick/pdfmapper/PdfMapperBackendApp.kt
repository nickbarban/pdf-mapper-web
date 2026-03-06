package com.nick.pdfmapper

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class PdfMapperBackendApp

fun main(args: Array<String>) {
  runApplication<PdfMapperBackendApp>(*args)
}
